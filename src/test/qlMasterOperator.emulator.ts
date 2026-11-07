import { Firestore,Timestamp } from '@google-cloud/firestore'
import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { captureQlMasterSnapshot,createQlMasterTransaction,runQlMasterOperation } from '../../scripts/ql-master-firestore'
import { applyQlMasterManifest,buildQlMasterManifest,buildQlMasterRollbackApproval } from '../lib/qlMasterOperator'

/** Real server SDK against only the explicitly named local demo Emulator. */
export function defineQlMasterOperatorEmulatorTests(environment:()=>RulesTestEnvironment){
  describe('Firestore Emulator: approved QL server transactions',()=>{
    let db:Firestore
    const projectId='demo-ccm-rules',actorEmail='operator@example.invalid'
    beforeEach(async()=>{
      const host=process.env.FIRESTORE_EMULATOR_HOST
      if(!host||!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host))throw new Error('Operator integration tests require a loopback demo Emulator.')
      await environment().clearFirestore()
      db=new Firestore({projectId,databaseId:'(default)'})
    })
    afterEach(async()=>{await db?.terminate()})
    it('atomically adopts once under concurrent repeats and restores missing fields without deleting new IDs',async()=>{
      await db.doc('fishSpecies/jin_xian').set({speciesCode:'jin_xian',displayName:'金线',active:true,order:1,notes:'keep',
        createdBy:'old',createdAt:new Timestamp(1,1),updatedBy:'old',updatedAt:new Timestamp(1,1),inactiveBy:null,inactiveAt:null})
      await db.doc('purchaseReceipts/history').set({priceCents:205,locked:true})
      const initial=await captureQlMasterSnapshot(db)
      const manifest=await buildQlMasterManifest({projectId,actorEmail,snapshot:initial.snapshot})
      const context={projectId,actorEmail,approvedHash:manifest.sha256,approvedAction:'apply' as const}
      const initialAttempts=await Promise.all([runQlMasterOperation(db,manifest,context),runQlMasterOperation(db,manifest,context)])
      expect(initialAttempts.map(result=>result.status).sort()).toEqual(['already-applied','applied'])
      expect(initialAttempts.map(result=>result.writes).sort((left,right)=>left-right)).toEqual([0,34])
      const post=await captureQlMasterSnapshot(db,manifest.sha256)
      expect(post.snapshot).toHaveLength(34)
      const repeats=await Promise.all([runQlMasterOperation(db,manifest,context),runQlMasterOperation(db,manifest,context)])
      expect(repeats.every(result=>result.status==='already-applied'&&result.writes===0)).toBe(true)
      expect((await captureQlMasterSnapshot(db)).snapshot).toEqual(post.snapshot)
      const rollbackApproval=await buildQlMasterRollbackApproval(manifest,post.journal!,post.snapshot)
      const undone=await runQlMasterOperation(db,manifest,{projectId,actorEmail,approvedAction:'rollback',approvedHash:rollbackApproval.hash,rollbackApproval})
      expect(undone.status).toBe('rolled-back')
      const old=(await db.doc('fishSpecies/jin_xian').get()).data()!
      expect(old).not.toHaveProperty('basePriceCentsPerKg')
      expect(old).not.toHaveProperty('qlSourceRef')
      expect(old).toMatchObject({displayName:'金线',notes:'keep',active:true,createdBy:'old'})
      // Compare the authoritative server before-image, including its stored precision.
      expect({seconds:old.createdAt.seconds,nanoseconds:old.createdAt.nanoseconds})
        .toEqual(initial.snapshot.find(item=>item.id==='jin_xian')!.data.createdAt)
      const rest=(await captureQlMasterSnapshot(db)).snapshot.filter(item=>item.id!=='jin_xian')
      expect(rest).toHaveLength(33)
      expect(rest.every(item=>item.data.active===false&&typeof item.data.qlSourceRef==='string')).toBe(true)
      expect((await db.doc('purchaseReceipts/history').get()).data()).toEqual({priceCents:205,locked:true})
    })
    it('cancels the complete operation when a non-target record was added after approval',async()=>{
      const manifest=await buildQlMasterManifest({projectId,actorEmail,snapshot:[]})
      await db.doc('fishSpecies/unreviewed').set({speciesCode:'unreviewed',displayName:'未审核',active:true,order:1,notes:''})
      await expect(runQlMasterOperation(db,manifest,{projectId,actorEmail,approvedHash:manifest.sha256,approvedAction:'apply'})).rejects.toThrow('snapshot changed')
      expect((await db.collection('fishSpecies').get()).size).toBe(1)
      expect((await db.collection('fishSpeciesAdoptions').get()).size).toBe(0)
    })
    it('does not commit any queued write if the server transaction callback aborts',async()=>{
      const manifest=await buildQlMasterManifest({projectId,actorEmail,snapshot:[]})
      await expect(db.runTransaction(async transaction=>{
        const {adapter,now}=createQlMasterTransaction(db,transaction)
        await applyQlMasterManifest(adapter,manifest,{projectId,actorEmail,approvedHash:manifest.sha256,approvedAction:'apply',now})
        throw new Error('injected callback abort')
      })).rejects.toThrow('injected callback abort')
      expect((await db.collection('fishSpecies').get()).size).toBe(0)
      expect((await db.collection('fishSpeciesAdoptions').get()).size).toBe(0)
    })
    it('rejects rollback after an Admin edit-and-restore advances the version while preserving the after-image',async()=>{
      const manifest=await buildQlMasterManifest({projectId,actorEmail,snapshot:[]})
      await runQlMasterOperation(db,manifest,{projectId,actorEmail,approvedHash:manifest.sha256,approvedAction:'apply'})
      const post=await captureQlMasterSnapshot(db,manifest.sha256)
      const rollbackApproval=await buildQlMasterRollbackApproval(manifest,post.journal!,post.snapshot)
      const ref=db.doc(`fishSpecies/${post.snapshot[0].id}`),old=await ref.get()
      // Identical set() may be a server no-op. An actual edit then restore exercises ABA.
      await ref.update({notes:'intervening Admin edit'})
      await ref.set(old.data()!)
      const rewritten=await ref.get()
      expect(rewritten.data()).toEqual(old.data())
      expect(rewritten.updateTime!.isEqual(old.updateTime!)).toBe(false)
      await expect(runQlMasterOperation(db,manifest,{projectId,actorEmail,approvedAction:'rollback',approvedHash:rollbackApproval.hash,rollbackApproval})).rejects.toThrow('changed after adoption')
      expect((await db.doc(`fishSpeciesAdoptions/${manifest.sha256}`).get()).data()!.state).toBe('applied')
      expect((await db.collection('fishSpecies').get()).docs.every(item=>item.data().active)).toBe(true)
    })
  })
}
