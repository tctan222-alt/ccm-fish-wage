import { access,readFile,writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  buildQlMasterManifest,buildQlMasterRollbackApproval,validateQlMasterManifest,validateQlMasterOperationApproval,
  type QlMasterManifest,type QlMasterRollbackApproval,type MasterDocument,
} from '../src/lib/qlMasterOperator'
import { captureQlMasterSnapshot,connectApprovedQlMaster,runQlMasterOperation } from './ql-master-firestore'

type Options=Record<string,string|boolean>
export function parseQlMasterArgs(args:readonly string[]):{command:string;options:Options}{
  const [command='help',...rest]=args,options:Options={}
  for(let index=0;index<rest.length;index++){
    const key=rest[index]
    if(!key.startsWith('--')||key in options)throw new Error('Unknown positional or duplicate argument.')
    const next=rest[index+1]
    options[key]=next&&!next.startsWith('--')?rest[++index]:true
  }
  const allowed=new Set(['--project','--actor','--snapshot','--manifest','--separate','--output','--read-approved','--execute','--approved-hash','--rollback-approval','--emulator'])
  if(Object.keys(options).some(key=>!allowed.has(key)))throw new Error('Unknown operator argument.')
  for(const key of ['--read-approved','--execute','--emulator'])if(key in options&&options[key]!==true)throw new Error(`${key} is an explicit boolean switch, not a value.`)
  return {command,options}
}
const text=(options:Options,key:string)=>{
  if(typeof options[key]!=='string'||!String(options[key]).trim())throw new Error(`${key} must be explicitly provided.`)
  return String(options[key])
}
const readJson=async<T>(filename:string):Promise<T>=>JSON.parse(await readFile(filename,'utf8')) as T
const writeJson=async(filename:string,value:unknown)=>writeFile(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
const ensureNewOutput=async(filename:string)=>{
  try{await access(filename)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  throw new Error('Output already exists; choose a new restricted output path before any connection.')
}

export async function runQlMasterCli(args:readonly string[]):Promise<void>{
  const {command,options}=parseQlMasterArgs(args)
  if(command==='help'){
    console.log('Offline plan: ql-master plan --snapshot FILE --project PROJECT --actor EMAIL --output FILE [--separate FILE]')
    console.log('Protected reads: snapshot | status | rollback-plan require --read-approved --project PROJECT --actor EMAIL --output FILE; status/rollback-plan also --manifest FILE')
    console.log('Protected writes: apply | rollback default to OFFLINE validation. --execute requires --approved-hash HASH, exact --project/--actor/--manifest; rollback also --rollback-approval FILE. Existing ADC only. Demo requires --emulator.')
    return
  }
  if(!['plan','snapshot','status','rollback-plan','apply','rollback'].includes(command))throw new Error('Unknown operator command.')
  const projectId=text(options,'--project'),actorEmail=text(options,'--actor')
  if(command==='plan'){
    const input=await readJson<{snapshot:MasterDocument[];projectId:string;actorEmail:string}>(text(options,'--snapshot'))
    if(input.projectId!==projectId||input.actorEmail!==actorEmail)throw new Error('Snapshot project/operator differ from the requested approval scope.')
    const createSeparateFor=options['--separate']?await readJson<string[]>(text(options,'--separate')):[]
    const manifest=await buildQlMasterManifest({projectId,actorEmail,snapshot:input.snapshot,createSeparateFor})
    await writeJson(text(options,'--output'),manifest)
    console.log(`OFFLINE manifest ${manifest.sha256}; ${manifest.entries.length} groups. No Firebase connection or mutation.`)
    return
  }
  const manifest=command==='snapshot'?null:await readJson<QlMasterManifest>(text(options,'--manifest'))
  if(manifest){
    await validateQlMasterManifest(manifest)
    if(manifest.projectId!==projectId||manifest.actorEmail!==actorEmail)throw new Error('Manifest project/operator differ from the requested approval scope.')
  }
  const write=command==='apply'||command==='rollback'
  if(write&&!options['--execute']){
    console.log(`OFFLINE validation only; ${manifest!.sha256}. No Firebase connection or mutation. Explicit --execute and action-specific approved hash are required.`)
    return
  }
  if(!write&&options['--read-approved']!==true)throw new Error('No production read authorization supplied; --read-approved is required.')
  const output=text(options,'--output')
  await ensureNewOutput(output)
  let rollbackApproval:QlMasterRollbackApproval|undefined
  const approvedHash=write?text(options,'--approved-hash'):''
  if(command==='rollback')rollbackApproval=await readJson<QlMasterRollbackApproval>(text(options,'--rollback-approval'))
  if(write)await validateQlMasterOperationApproval(manifest!,{projectId,actorEmail,approvedHash,
    approvedAction:command as 'apply'|'rollback',rollbackApproval,now:()=>{throw new Error('Offline validation cannot obtain a server timestamp.')}},command as 'apply'|'rollback')
  // Establish existing IAM identity only after every offline/file/scope check above.
  const db=await connectApprovedQlMaster(projectId,actorEmail,options['--emulator']===true)
  try{
    if(write){
      const result=await runQlMasterOperation(db,manifest!,{projectId,actorEmail,approvedHash,approvedAction:command as 'apply'|'rollback',rollbackApproval})
      try{await writeJson(output,{...result,projectId,actorEmail})}
      catch{throw new Error(`SERVER ${result.status}; local receipt could not be saved. Do not infer transaction failure or blindly retry. Use authorized status for ${manifest!.journalCollection}/${manifest!.sha256}.`)}
      console.log(`${result.status}; ${result.writes} Master writes; authoritative journal ${manifest!.journalCollection}/${manifest!.sha256}. Receipt saved. A lost receipt is not proof of transaction failure; use authorized status.`)
    }else{
      const captured=await captureQlMasterSnapshot(db,manifest?.sha256)
      if(command==='rollback-plan'){
        if(!captured.journal)throw new Error('No authoritative operation journal; rollback cannot be planned.')
        const approval=await buildQlMasterRollbackApproval(manifest!,captured.journal,captured.snapshot)
        await writeJson(output,approval)
        console.log(`Read-only rollback approval ${approval.hash}; no writes. This is a separate action requiring separate authorization.`)
      }else{
        await writeJson(output,{projectId,actorEmail,...captured})
        console.log(`Read-only ${command} saved; ${captured.snapshot.length} Master documents; no writes.`)
      }
    }
  }finally{await db.terminate()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runQlMasterCli(process.argv.slice(2)).catch(error=>{
    const message=error instanceof Error?error.message:'Unknown operator failure'
    console.error(message.replace(/(access_token=|Bearer\s+)[^\s&]+/gi,'$1[REDACTED]'))
    process.exitCode=1
  })
}
