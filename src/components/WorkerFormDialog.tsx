import { useRef,useState,type FormEvent } from 'react'
import { workerDepartmentFromWorker,validateWorker,type WorkerInput } from '../lib/masterData'
import type { Worker } from '../types'

interface Props {
  worker?:Worker|null;save:(input:WorkerInput)=>Promise<Worker>;onSaved:(worker:Worker)=>void;onClose:()=>void
  onDeactivate?:(worker:Worker)=>Promise<void>;onReactivate?:(worker:Worker)=>Promise<void>
}
export function WorkerFormDialog({worker,save,onSaved,onClose,onDeactivate,onReactivate}:Props){
  const [value,setValue]=useState<WorkerInput>({
    name:worker?.name??'',phone:worker?.phone??'',department:worker?.department??'',workerDepartment:workerDepartmentFromWorker(worker??{})??'other',
    employmentStartDate:worker?.employmentStartDate??'',employmentEndDate:worker?.employmentEndDate??'',notes:worker?.notes??'',
  })
  const [error,setError]=useState('');const [saving,setSaving]=useState(false);const lock=useRef(false)
  const change=(key:keyof WorkerInput,next:string)=>setValue(current=>({...current,[key]:next}))
  async function submit(event:FormEvent){event.preventDefault();if(lock.current)return;const errors=validateWorker(value);if(errors.length){setError(errors[0]);return}
    lock.current=true;setSaving(true);setError('');try{onSaved(await save(value))}catch(problem){setError(problem instanceof Error?problem.message:'Worker was not saved.')}finally{lock.current=false;setSaving(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-form-title">
    <h2 id="worker-form-title">{worker?'Edit':'Add'} Worker</h2><form className="master-form" onSubmit={submit}>
      <label>Worker name<input value={value.name} maxLength={100} onChange={e=>change('name',e.target.value)}/></label>
      <label>Phone<input value={value.phone} maxLength={30} onChange={e=>change('phone',e.target.value)}/></label>
      <fieldset><legend>部门</legend>
        <label><input type="radio" name="worker-department" checked={value.workerDepartment==='fish_head_cutting'} onChange={()=>change('workerDepartment','fish_head_cutting')}/>切鱼头工钱</label>
        <label><input type="radio" name="worker-department" checked={value.workerDepartment==='ccm_general'} onChange={()=>change('workerDepartment','ccm_general')}/>CCM 普通</label>
        <label><input type="radio" name="worker-department" checked={value.workerDepartment==='other'} onChange={()=>change('workerDepartment','other')}/>其他</label>
      </fieldset>
      <label>Start date<input type="date" value={value.employmentStartDate} onChange={e=>change('employmentStartDate',e.target.value)}/></label>
      <label>End date<input type="date" value={value.employmentEndDate} onChange={e=>change('employmentEndDate',e.target.value)}/></label>
      <label>Notes<textarea value={value.notes} maxLength={500} onChange={e=>change('notes',e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={saving}>{saving?'Saving…':'Save Worker'}</button>
      {worker&&(worker.active?onDeactivate:onReactivate)&&<button type="button" className={worker.active?'danger-action':'activate-action'} disabled={saving}
        onClick={async()=>{if(lock.current)return;if(worker.active&&!window.confirm(`Deactivate ${worker.name}? Historical wage records will remain unchanged.`))return
          lock.current=true;setSaving(true);try{await (worker.active?onDeactivate:onReactivate)?.(worker);onClose()}catch{setError('Worker status was not changed.')}finally{lock.current=false;setSaving(false)}}}>
        {worker.active?'Deactivate Worker':'Reactivate Worker'}
      </button>}
      <button type="button" className="secondary-action" disabled={saving} onClick={onClose}>Cancel</button>
    </form>
  </section></div>
}
