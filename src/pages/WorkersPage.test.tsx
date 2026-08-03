import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { WorkersPage } from './WorkersPage'

afterEach(()=>cleanup())

describe('worker master data page',()=>{
  it('shows legacy workers and enhanced fields without requiring migration',async()=>{
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'legacy-id',name:'Ali',active:true,order:1},
    ]}/></MemoryRouter>)
    expect(await screen.findByText('Ali')).toBeInTheDocument()
    expect(screen.getByText('ID: legacy-id')).toBeInTheDocument()
    expect(screen.getByText('未分类（请设置）')).toBeInTheDocument()
  })

  it('filters active and inactive workers and offers no delete action',async()=>{
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'w1',name:'Active Worker',active:true,order:1,workerCode:'WK-11111111'},
      {id:'w2',name:'Inactive Worker',active:false,order:2,workerCode:'WK-22222222'},
    ]}/></MemoryRouter>)
    await screen.findByText('Active Worker')
    fireEvent.change(screen.getByLabelText('Worker filter'),{target:{value:'inactive'}})
    expect(screen.queryByText('Active Worker')).not.toBeInTheDocument()
    expect(screen.getByText('Inactive Worker')).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/delete/i})).not.toBeInTheDocument()
  })

  it('requires confirmation before deactivating without deleting the worker',async()=>{
    const deactivator=vi.fn(async()=>{})
    vi.spyOn(window,'confirm').mockReturnValue(false)
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'w1',name:'Ali',active:true,order:1},
    ]} deactivator={deactivator}/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Deactivate Ali'}))
    expect(deactivator).not.toHaveBeenCalled()
  })

  it('rejects a duplicate worker name when adding',async()=>{
    const creator=vi.fn()
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'w1',name:'Ali',active:true,order:1},
    ]} creator={creator}/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Add Worker'}))
    fireEvent.change(screen.getByLabelText('Worker name'),{target:{value:' ali '}})
    fireEvent.click(screen.getByRole('button',{name:'Save Worker'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(creator).not.toHaveBeenCalled()
  })

  it('rejects editing a worker to another existing worker name',async()=>{
    const updater=vi.fn()
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'w1',name:'Ali',active:true,order:1},
      {id:'w2',name:'Ah Mei',active:true,order:2},
    ]} updater={updater}/></MemoryRouter>)
    await screen.findByText('Ali')
    const editButtons=screen.getAllByRole('button',{name:'Edit'})
    fireEvent.click(editButtons[1])
    fireEvent.change(screen.getByLabelText('Worker name'),{target:{value:' ali '}})
    fireEvent.click(screen.getByRole('button',{name:'Save Worker'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(updater).not.toHaveBeenCalled()
  })

  it('prevents repeated worker saves while the first request is pending',async()=>{
    let resolve:(worker:{id:string;name:string;active:boolean;order:number})=>void=()=>{}
    const creator=vi.fn(()=>new Promise<{id:string;name:string;active:boolean;order:number}>(done=>{resolve=done}))
    render(<MemoryRouter><WorkersPage loader={async()=>[]} creator={creator}/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Add Worker'}))
    fireEvent.change(screen.getByLabelText('Worker name'),{target:{value:'New Worker'}})
    const save=screen.getByRole('button',{name:'Save Worker'})
    fireEvent.click(save);fireEvent.click(save)
    expect(creator).toHaveBeenCalledOnce()
    expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled()
    resolve({id:'new',name:'New Worker',active:true,order:0})
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('允许在主资料以中文设置工人部门，不删除其他工人',async()=>{
    const creator=vi.fn(async(input)=>({id:'new',name:input.name,active:true,order:0,...input}))
    render(<MemoryRouter><WorkersPage loader={async()=>[
      {id:'ccm',name:'CCM 工人',active:true,order:1,workerDepartment:'ccm_general'},
      {id:'other',name:'其他工人',active:true,order:2,workerDepartment:'other'},
    ]} creator={creator}/></MemoryRouter>)
    expect(await screen.findByText('CCM 工人')).toBeInTheDocument()
    expect(screen.getByText('其他工人')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Add Worker'}))
    fireEvent.change(screen.getByLabelText('Worker name'),{target:{value:'新切鱼头工人'}})
    fireEvent.click(screen.getByLabelText('切鱼头工钱'))
    fireEvent.click(screen.getByRole('button',{name:'Save Worker'}))
    await waitFor(()=>expect(creator).toHaveBeenCalledOnce())
    expect(creator.mock.calls[0][0]).toMatchObject({workerDepartment:'fish_head_cutting'})
  })
})
