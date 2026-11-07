import { FieldPath,Firestore,Timestamp,type Transaction } from '@google-cloud/firestore'
import { GoogleAuth,OAuth2Client } from 'google-auth-library'
import {
  QL_MASTER_COLLECTION,QL_MASTER_JOURNAL_COLLECTION,QL_MASTER_MAX_DOCUMENTS,
  applyQlMasterManifest,rollbackQlMasterManifest,type MasterDocument,type OperatorTimestamp,
  type QlMasterJournal,type QlMasterManifest,type QlMasterOperatorContext,type QlMasterTransaction,
} from '../src/lib/qlMasterOperator'

export function plainFirestoreValue(value:unknown):unknown {
  if(value instanceof Timestamp)return {seconds:value.seconds,nanoseconds:value.nanoseconds}
  if(Array.isArray(value))return value.map(plainFirestoreValue)
  if(value&&typeof value==='object'){
    if(Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Unsupported Firestore field type; no field will be dropped.')
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,plainFirestoreValue(item)]))
  }
  return value
}

export function storedFirestoreValue(value:unknown):unknown {
  if(Array.isArray(value))return value.map(storedFirestoreValue)
  if(value&&typeof value==='object'){
    const fields=value as Record<string,unknown>
    if(Object.keys(fields).length===2&&Number.isSafeInteger(fields.seconds)&&Number.isInteger(fields.nanoseconds)){
      return new Timestamp(Number(fields.seconds),Number(fields.nanoseconds))
    }
    return Object.fromEntries(Object.entries(fields).map(([key,item])=>[key,storedFirestoreValue(item)]))
  }
  return value
}

const version=(value:Timestamp)=>`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`
const stamp=(value:Timestamp):OperatorTimestamp=>({seconds:value.seconds,nanoseconds:value.nanoseconds})

/** A single query inside a server transaction, not a preflight query before it. */
export function createQlMasterTransaction(db:Firestore,transaction:Transaction){
  let readTime:OperatorTimestamp|null=null
  const adapter:QlMasterTransaction={
    async readAll(){
      const snapshot=await transaction.get(db.collection(QL_MASTER_COLLECTION).orderBy(FieldPath.documentId()).limit(QL_MASTER_MAX_DOCUMENTS+1))
      if(snapshot.size>QL_MASTER_MAX_DOCUMENTS)throw new Error('Master exceeds the approved 1000-document read scope; stopped.')
      readTime=stamp(snapshot.readTime)
      return snapshot.docs.map(item=>({id:item.id,data:plainFirestoreValue(item.data()) as Record<string,unknown>,version:version(item.updateTime)}))
    },
    async readJournal(hash){
      const snapshot=await transaction.get(db.collection(QL_MASTER_JOURNAL_COLLECTION).doc(hash))
      return snapshot.exists?plainFirestoreValue(snapshot.data()) as QlMasterJournal:null
    },
    setSpecies(id,data){transaction.set(db.collection(QL_MASTER_COLLECTION).doc(id),storedFirestoreValue(data) as Record<string,unknown>)},
    setJournal(hash,journal){transaction.set(db.collection(QL_MASTER_JOURNAL_COLLECTION).doc(hash),storedFirestoreValue(journal) as Record<string,unknown>)},
  }
  return {adapter,now(){
    if(!readTime)throw new Error('Read the complete server snapshot before generating operation audit timestamps.')
    return readTime
  }}
}

export async function captureQlMasterSnapshot(db:Firestore,hash?:string):Promise<{snapshot:MasterDocument[];journal:QlMasterJournal|null}> {
  return db.runTransaction(async transaction=>{
    const {adapter}=createQlMasterTransaction(db,transaction)
    const snapshot=await adapter.readAll()
    const journal=hash?await adapter.readJournal(hash):null
    return {snapshot,journal}
  },{readOnly:true})
}

export async function runQlMasterOperation(db:Firestore,manifest:QlMasterManifest,context:Omit<QlMasterOperatorContext,'now'>){
  return db.runTransaction(async transaction=>{
    const {adapter,now}=createQlMasterTransaction(db,transaction)
    return context.approvedAction==='apply'
      ?applyQlMasterManifest(adapter,manifest,{...context,now})
      :rollbackQlMasterManifest(adapter,manifest,{...context,now})
  })
}

/** Use only the pre-existing IAM identity; no key creation, login, secret export or browser token. */
export async function connectApprovedQlMaster(projectId:string,actorEmail:string,emulator:boolean):Promise<Firestore>{
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actorEmail))throw new Error('An explicitly approved IAM operator email is required.')
  let verifiedAuth:GoogleAuth|undefined
  if(projectId==='demo-ccm-rules'){
    if(!emulator||!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')){
      throw new Error('Demo tools require --emulator and a loopback FIRESTORE_EMULATOR_HOST.')
    }
  }else{
    if(projectId!=='ccm-fishery-os-4490d'||emulator||process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Unexpected production project or emulator routing.')
    const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore','openid','email']})
    const client=await auth.getClient()
    const token=await client.getAccessToken()
    if(!token.token)throw new Error('Existing ADC identity could not provide a token; no login or key was created.')
    const identity=await new OAuth2Client().getTokenInfo(token.token)
    if(!identity.email||identity.email!==actorEmail)throw new Error('Authenticated IAM identity does not equal the approved operator email.')
    verifiedAuth=auth
  }
  // google-gax consumes this same verified GoogleAuth object; do not re-resolve ADC.
  return new Firestore({projectId,databaseId:'(default)',...(verifiedAuth?{auth:verifiedAuth}:{})})
}
