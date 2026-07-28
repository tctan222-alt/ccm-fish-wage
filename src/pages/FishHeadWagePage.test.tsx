import { fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe,expect,it,vi } from 'vitest'
import { FishHeadWagePage } from './FishHeadWagePage'
const workers=[{id:'w1',name:'Ah Mei',active:true,order:1}]
const setup=(saver=vi.fn().mockResolvedValue(undefined),now=()=>1_000_000)=>{render(<MemoryRouter><FishHeadWagePage workerLoader={async()=>workers} saver={saver} now={now}/></MemoryRouter>);return saver}
async function chooseAndEnter(){fireEvent.click(await screen.findByText('Ah Mei'));fireEvent.click(screen.getByText('7'));fireEvent.click(screen.getByText('4'))}
describe('fish head entry flow',()=>{
 it('keeps worker and rate, but clears weight after save',async()=>{const saver=setup();await chooseAndEnter();fireEvent.click(screen.getByText('Confirm entry'));await waitFor(()=>expect(saver).toHaveBeenCalledOnce());expect(screen.getByText('Ah Mei')).toHaveAttribute('aria-pressed','true');expect(screen.getByText('RM0.12')).toHaveAttribute('aria-pressed','true');expect(screen.getByText(/Saved: Ah Mei, 74kg/)).toBeInTheDocument();expect(screen.getByText('0')).toBeInTheDocument()})
 it('allows only one save from rapid double tap',async()=>{let resolve!:()=>void;const saver=vi.fn(()=>new Promise<void>(r=>{resolve=r}));setup(saver);await chooseAndEnter();const button=screen.getByText('Confirm entry');fireEvent.click(button);fireEvent.click(button);expect(saver).toHaveBeenCalledOnce();resolve();await waitFor(()=>expect(button).not.toBeDisabled())})
 it('warns and explicitly confirms a possible duplicate within five seconds',async()=>{let time=1_000_000;const saver=setup(undefined,()=>time);await chooseAndEnter();fireEvent.click(screen.getByText('Confirm entry'));await waitFor(()=>expect(saver).toHaveBeenCalledOnce());time+=4000;fireEvent.click(screen.getByText('7'));fireEvent.click(screen.getByText('4'));fireEvent.click(screen.getByText('Confirm entry'));expect(await screen.findByText('Possible duplicate entry.')).toBeInTheDocument();expect(saver).toHaveBeenCalledOnce();fireEvent.click(screen.getByText('Save again'));await waitFor(()=>expect(saver).toHaveBeenCalledTimes(2))})
})
