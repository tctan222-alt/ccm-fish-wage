interface Props {
  value:string
  onChange:(value:string)=>void
  onConfirm:()=>void
  disabled?:boolean
}

function keypadFeedback(){
  navigator.vibrate?.(12)
}

export function DecimalKeypad({value,onChange,onConfirm,disabled=false}:Props){
  function append(character:string){
    if(disabled)return
    if(character==='.'&&value.includes('.'))return
    const [whole='',fraction='']=value.split('.')
    if(character!=='.'&&value.includes('.')&&fraction.length>=3)return
    if(character!=='.'&&!value.includes('.')&&whole.length>=6)return
    keypadFeedback()
    onChange(value+character)
  }

  function backspace(){
    if(disabled)return
    keypadFeedback();onChange(value.slice(0,-1))
  }

  function clear(){
    if(disabled)return
    keypadFeedback();onChange('')
  }

  return <div className="decimal-keypad" role="group" aria-label="重量数字键盘">
    {['7','8','9','4','5','6','1','2','3','.','0'].map(valueItem=><button type="button" key={valueItem}
      disabled={disabled} onClick={()=>append(valueItem)}>{valueItem}</button>)}
    <button type="button" disabled={disabled} onClick={backspace}>⌫</button>
    <button type="button" className="decimal-keypad-clear" disabled={disabled} onClick={clear}>清空</button>
    <button type="button" className="decimal-keypad-confirm" disabled={disabled} onClick={onConfirm}>确认加入</button>
  </div>
}
