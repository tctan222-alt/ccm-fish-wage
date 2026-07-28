interface Props { value:string; onChange:(value:string)=>void }
export function NumericKeypad({value,onChange}:Props){
  const digit=(d:string)=>onChange((value+d).replace(/^0+(?=\d)/,''))
  return <div className="keypad" aria-label="Weight keypad">{['1','2','3','4','5','6','7','8','9'].map(d=><button key={d} onClick={()=>digit(d)}>{d}</button>)}<button onClick={()=>onChange('')} aria-label="Clear">Clear</button><button onClick={()=>digit('0')}>0</button><button onClick={()=>onChange(value.slice(0,-1))} aria-label="Backspace">⌫</button></div>
}
