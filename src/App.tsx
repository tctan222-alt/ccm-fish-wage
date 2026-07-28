import { BrowserRouter,Route,Routes } from 'react-router-dom'
import { FishHeadWagePage } from './pages/FishHeadWagePage'
export default function App(){return <BrowserRouter><Routes><Route path="*" element={<FishHeadWagePage/>}/></Routes></BrowserRouter>}
