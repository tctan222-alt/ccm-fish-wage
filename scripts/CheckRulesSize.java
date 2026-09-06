import com.google.firebase.rules.lang.FirebaseRulesProtoCompiler;
import com.google.firebase.rules.lang.common.FirebaseRulesLangOptions;
import com.google.firebase.rules.v1.Source;
import com.google.firebase.rules.v1.File;
import com.google.protobuf.Message;
import com.google.protobuf.Descriptors;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;

class CheckRulesSize {
  // Emulator compiler internals: see docs/FIRESTORE_RULES_SIZE.md for calibration.
  static Message deployedForm(Message value, String parent) {
    var out = value.toBuilder();
    for (var entry : value.getAllFields().entrySet()) {
      var field = entry.getKey();
      if (field.getName().equals("source_position") && !parent.equals("Permission.allow")) {
        out.clearField(field);
        continue;
      }
      if (field.getJavaType() != Descriptors.FieldDescriptor.JavaType.MESSAGE) continue;
      var next = value.getDescriptorForType().getName() + "." + field.getName();
      if (field.isRepeated()) {
        var children = (List<?>) entry.getValue();
        for (int i = 0; i < children.size(); i++) {
          out.setRepeatedField(field, i, deployedForm((Message) children.get(i), next));
        }
      } else out.setField(field, deployedForm((Message) entry.getValue(), next));
    }
    return out.build();
  }

  public static void main(String[] args) throws Exception {
    var source = Source.newBuilder().addFiles(File.newBuilder()
      .setName("firestore.rules").setContent(Files.readString(Path.of(args[0]))));
    var options = FirebaseRulesLangOptions.builder().allowTernaryOperator(true).build();
    var compiled = FirebaseRulesProtoCompiler.createStandalone(options).compile(source);
    if (compiled.hasCompilationError()) throw new IllegalStateException("Firestore Rules compilation failed");
    int bytes = deployedForm(compiled.getRulesetAst(), "root").getSerializedSize();
    // Leave 2 KiB below the 250 KiB runtime cap for compiler/backend drift.
    int budget = 250 * 1024 - 2048;
    System.out.printf("Compiled Rules size estimate: %,d bytes; CI budget: %,d; runtime cap: 256,000%n", bytes, budget);
    if (bytes > budget) throw new IllegalStateException("Compiled Firestore Rules exceed the CI size budget");
  }
}
