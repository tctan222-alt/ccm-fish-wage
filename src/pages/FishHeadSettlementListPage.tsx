import { SettlementListPage,type SettlementListProps } from './SettlementListPage'
export function FishHeadSettlementListPage(props:Omit<SettlementListProps,'productType'>){return <SettlementListPage {...props} productType="fish_head"/>}
