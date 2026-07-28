interface Props { value:string; onChange:(value:string)=>void }

function keypadFeedback(){
  navigator.vibrate?.(12)
}

export function NumericKeypad({value,onChange}:Props){
  const digit=(d:string)=>{
    keypadFeedback()
    onChange((value+d).replace(/^0+(?=\d)/,''))
  }

  const clear=()=>{
    keypadFeedback()
    onChange('')
  }

  const backspace=()=>{
    keypadFeedback()
    onChange(value.slice(0,-1))
  }

  return <div className="keypad" aria-label="Weight keypad">
    {['1','2','3','4','5','6','7','8','9'].map(d=>
      <button type="button" key={d} onClick={()=>digit(d)}>{d}</button>
    )}
    <button type="button" onClick={clear} aria-label="Clear">Clear</button>
    <button type="button" onClick={()=>digit('0')}>0</button>
    <button type="button" onClick={backspace} aria-label="Backspace">⌫</button>
  </div>
}