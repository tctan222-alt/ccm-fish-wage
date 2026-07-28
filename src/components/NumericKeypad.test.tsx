import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import { NumericKeypad } from './NumericKeypad'

function Harness(){
  const [value,setValue]=useState('')
  return <><output aria-label="Current value">{value}</output><NumericKeypad value={value} onChange={setValue}/></>
}

it('normalizes weight and supports Backspace and Clear',()=>{
  render(<Harness/>)
  const zero=screen.getByRole('button',{name:'0'})
  fireEvent.click(zero)
  fireEvent.click(zero)
  fireEvent.click(screen.getByRole('button',{name:'7'}))
  expect(screen.getByLabelText('Current value')).toHaveTextContent('7')
  fireEvent.click(screen.getByRole('button',{name:'Backspace'}))
  expect(screen.getByLabelText('Current value')).toHaveTextContent('')
  fireEvent.click(screen.getByRole('button',{name:'8'}))
  fireEvent.click(screen.getByRole('button',{name:'Clear'}))
  expect(screen.getByLabelText('Current value')).toHaveTextContent('')
})
