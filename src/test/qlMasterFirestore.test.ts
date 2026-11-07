import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { connectApprovedQlMaster } from '../../scripts/ql-master-firestore'

const identity=vi.hoisted(()=>({auth:vi.fn(),client:vi.fn(),token:vi.fn(),info:vi.fn(),firestore:vi.fn()}))
vi.mock('google-auth-library',()=>({
  GoogleAuth:class{constructor(options:unknown){identity.auth(this,options)}getClient(){return identity.client()}},
  OAuth2Client:class{getTokenInfo(token:string){return identity.info(token)}},
}))
vi.mock('@google-cloud/firestore',()=>({Firestore:class{constructor(options:unknown){identity.firestore(options)}},FieldPath:{},Timestamp:class{}}))
beforeEach(()=>{
  identity.auth.mockReset();identity.client.mockReset().mockResolvedValue({getAccessToken:identity.token})
  identity.token.mockReset().mockResolvedValue({token:'not-a-real-token'})
  identity.info.mockReset().mockResolvedValue({email:'operator@example.invalid'})
  identity.firestore.mockReset()
  vi.stubEnv('FIRESTORE_EMULATOR_HOST','')
})
afterEach(()=>vi.unstubAllEnvs())
describe('QL operator authenticated transport',()=>{
  it('binds Firestore to the same IAM auth object whose email was verified',async()=>{
    await connectApprovedQlMaster('ccm-fishery-os-4490d','operator@example.invalid',false)
    expect(identity.firestore.mock.calls[0][0].auth).toBe(identity.auth.mock.calls[0][0])
  })
  it('rejects a different identity without constructing a Firestore connection',async()=>{
    await expect(connectApprovedQlMaster('ccm-fishery-os-4490d','someone-else@example.invalid',false)).rejects.toThrow('does not equal')
    expect(identity.firestore).not.toHaveBeenCalled()
  })
  it('rejects malformed actors, unexpected projects and emulator rerouting before auth',async()=>{
    await expect(connectApprovedQlMaster('other-project','operator@example.invalid',false)).rejects.toThrow('Unexpected')
    await expect(connectApprovedQlMaster('ccm-fishery-os-4490d','invalid',false)).rejects.toThrow('email')
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8080')
    await expect(connectApprovedQlMaster('ccm-fishery-os-4490d','operator@example.invalid',false)).rejects.toThrow('routing')
    expect(identity.auth).not.toHaveBeenCalled()
  })
  it('permits only explicitly selected loopback demo transport without resolving ADC',async()=>{
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','remote-host:8080')
    await expect(connectApprovedQlMaster('demo-ccm-rules','operator@example.invalid',true)).rejects.toThrow('loopback')
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8080')
    await connectApprovedQlMaster('demo-ccm-rules','operator@example.invalid',true)
    expect(identity.auth).not.toHaveBeenCalled()
    expect(identity.firestore).toHaveBeenCalledTimes(1)
  })
})
