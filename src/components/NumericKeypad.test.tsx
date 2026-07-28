import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { NumericKeypad } from './NumericKeypad'
function Harness(){const [value,setValue]=useState('');return <><output>{value}</output><NumericKeypad value={value} onChange={setValue}/></>}
it('normalizes weight and supports Backspace and Clear',()=>{render(<Harness/>);fireEvent.click(screen.getByText('0'));fireEvent.click(screen.getByText('0'));fireEvent.click(screen.getByText('7'));expect(screen.getByRole('status')).toHaveTextContent('7');fireEvent.click(screen.getByLabelText('Backspace'));expect(screen.getByRole('status')).toHaveTextContent('');fireEvent.click(screen.getByText('8'));fireEvent.click(screen.getByLabelText('Clear'));expect(screen.getByRole('status')).toHaveTextContent('')})
