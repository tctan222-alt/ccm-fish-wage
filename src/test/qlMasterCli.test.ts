import { webcrypto } from 'node:crypto'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { buildQlMasterManifest } from '../lib/qlMasterOperator'
import { parseQlMasterArgs,runQlMasterCli } from '../../scripts/ql-master'

const transport=vi.hoisted(()=>({connect:vi.fn(),capture:vi.fn(),run:vi.fn(),terminate:vi.fn()}))
vi.mock('../../scripts/ql-master-firestore',()=>({connectApprovedQlMaster:transport.connect,captureQlMasterSnapshot:transport.capture,runQlMasterOperation:transport.run}))
let directory:string
beforeEach(async()=>{
  vi.stubGlobal('crypto',webcrypto)
  vi.spyOn(console,'log').mockImplementation(()=>{})
  transport.connect.mockReset().mockResolvedValue({terminate:transport.terminate})
  transport.capture.mockReset();transport.run.mockReset();transport.terminate.mockReset()
  directory=await mkdtemp(path.join(tmpdir(),'ccm-ql-operator-'))
})
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await rm(directory,{recursive:true,force:true})})
const actor='operator@example.invalid',project='demo-ccm-rules'
async function manifestFile(){
  const manifest=await buildQlMasterManifest({projectId:project,actorEmail:actor,snapshot:[]})
  const filename=path.join(directory,'manifest.json')
  await writeFile(filename,JSON.stringify(manifest))
  return {manifest,filename}
}

describe('QL operator CLI explicit authorization',()=>{
  it('keeps help and apply validation completely offline by default',async()=>{
    await runQlMasterCli([])
    const {filename}=await manifestFile()
    await runQlMasterCli(['apply','--project',project,'--actor',actor,'--manifest',filename])
    expect(transport.connect).not.toHaveBeenCalled()
    expect(transport.run).not.toHaveBeenCalled()
  })
  it('rejects an incorrect apply hash before authentication, reads or writes',async()=>{
    const {filename}=await manifestFile()
    await expect(runQlMasterCli(['apply','--execute','--project',project,'--actor',actor,'--manifest',filename,
      '--approved-hash','wrong','--output',path.join(directory,'receipt.json')])).rejects.toThrow('hash')
    expect(transport.connect).not.toHaveBeenCalled()
  })
  it('does not read a snapshot without its separate read approval',async()=>{
    await expect(runQlMasterCli(['snapshot','--project',project,'--actor',actor,'--output',path.join(directory,'snapshot.json')])).rejects.toThrow('--read-approved')
    expect(transport.connect).not.toHaveBeenCalled()
  })
  it('rejects a tampered manifest and changed project before connection',async()=>{
    const {manifest,filename}=await manifestFile()
    await writeFile(filename,JSON.stringify({...manifest,actorEmail:'different@example.invalid'}))
    await expect(runQlMasterCli(['apply','--project',project,'--actor',actor,'--manifest',filename])).rejects.toThrow('SHA-256')
    expect(transport.connect).not.toHaveBeenCalled()
  })
  it('does not accept value-shaped, duplicate or unknown execution switches',()=>{
    expect(()=>parseQlMasterArgs(['apply','--execute','false'])).toThrow('boolean')
    expect(()=>parseQlMasterArgs(['apply','--execute','--execute'])).toThrow('duplicate')
    expect(()=>parseQlMasterArgs(['apply','--force'])).toThrow('Unknown')
  })
  it('does not authenticate when the requested receipt path already exists',async()=>{
    const {manifest,filename}=await manifestFile(),output=path.join(directory,'existing.json')
    await writeFile(output,'preserve')
    await expect(runQlMasterCli(['apply','--execute','--project',project,'--actor',actor,'--manifest',filename,
      '--approved-hash',manifest.sha256,'--output',output])).rejects.toThrow('Output already exists')
    expect(transport.connect).not.toHaveBeenCalled()
  })
  it('reports a confirmed commit truthfully if saving the local receipt then fails',async()=>{
    const {manifest,filename}=await manifestFile(),output=path.join(directory,'receipt.json')
    transport.run.mockImplementation(async()=>{
      await writeFile(output,'competing file')
      return {status:'applied',writes:36,manifestHash:manifest.sha256}
    })
    await expect(runQlMasterCli(['apply','--execute','--project',project,'--actor',actor,'--manifest',filename,
      '--approved-hash',manifest.sha256,'--output',output])).rejects.toThrow('SERVER applied; local receipt')
    expect(transport.run).toHaveBeenCalledTimes(1)
    expect(transport.capture).not.toHaveBeenCalled()
    expect(transport.terminate).toHaveBeenCalledTimes(1)
  })
})
