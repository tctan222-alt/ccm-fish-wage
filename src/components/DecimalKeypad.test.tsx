import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import { DecimalKeypad } from './DecimalKeypad'

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
