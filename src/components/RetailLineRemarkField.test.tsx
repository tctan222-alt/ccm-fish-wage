import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { RetailLineRemarkField } from './RetailLineRemarkField'

afterEach(cleanup)
function Field() {
  const [value, setValue] = useState('')
  return <><RetailLineRemarkField label="Remark" value={value} onChange={setValue} /><output>{value}</output></>
}
for (const preset of ['次', '参', '味']) {
  it(`keeps custom entry open when typing ${preset} as its first character`, async () => {
    const user = userEvent.setup()
    render(<Field />)
    await user.selectOptions(screen.getByLabelText('Remark'), 'other')
    const input = screen.getByLabelText('Remark · 其他备注 Custom Remark')
    await user.type(input, `${preset}货分开装`)
    expect(input).toHaveValue(`${preset}货分开装`)
    expect(screen.getByLabelText('Remark')).toHaveValue('other')
    await user.clear(input)
    expect(input).toHaveValue('')
    expect(screen.getByLabelText('Remark')).toHaveValue('other')
    await user.selectOptions(screen.getByLabelText('Remark'), preset)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(preset)
  })
}
it('loads external historical custom values and resets from the parent', () => {
  const { rerender } = render(<RetailLineRemarkField label="Remark" value="其他" onChange={() => {}} />)
  expect(screen.getByRole('textbox')).toHaveValue('其他')
  rerender(<RetailLineRemarkField label="Remark" value="次货" onChange={() => {}} />)
  expect(screen.getByRole('textbox')).toHaveValue('次货')
  rerender(<RetailLineRemarkField label="Remark" value="" onChange={() => {}} />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Remark'), { target: { value: 'other' } })
  expect(screen.getByRole('textbox')).toHaveValue('')
})
