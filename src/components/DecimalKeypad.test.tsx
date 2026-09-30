import { useState } from 'react'
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { DecimalKeypad } from './DecimalKeypad'

afterEach(cleanup)

function Harness(){
  const [value,setValue]=useState('')
  return <><output aria-label="重量值">{value}</output><DecimalKeypad value={value} onChange={setValue} onConfirm={()=>undefined}/></>
}

it('provides a decimal field keypad without allowing a second decimal point',()=>{
  render(<Harness/>)
  for(const label of ['8','0','.','5'])fireEvent.click(screen.getByRole('button',{name:label}))
  expect(screen.getByLabelText('重量值')).toHaveTextContent('80.5')
  fireEvent.click(screen.getByRole('button',{name:'.'}))
  expect(screen.getByLabelText('重量值')).toHaveTextContent('80.5')
  fireEvent.click(screen.getByRole('button',{name:'⌫'}))
  expect(screen.getByLabelText('重量值')).toHaveTextContent('80.')
  fireEvent.click(screen.getByRole('button',{name:'清空'}))
  expect(screen.getByLabelText('重量值')).toHaveTextContent('')
})

it('keeps digits available while confirmation waits for context validation',()=>{
  const onChange=vi.fn(),onConfirm=vi.fn()
  const view=render(<DecimalKeypad value="8" onChange={onChange} onConfirm={onConfirm} confirmDisabled/>)
  fireEvent.click(view.getByRole('button',{name:'0'}))
  expect(onChange).toHaveBeenCalledWith('80')
  expect(view.getByRole('button',{name:'确认加入'})).toBeDisabled()
  fireEvent.click(view.getByRole('button',{name:'确认加入'}))
  expect(onConfirm).not.toHaveBeenCalled()
})
