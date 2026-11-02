import { assetUrl } from '../../utils/assets'

export default function Brand() {
  return (
    <div className="brand" aria-label="넷레이더">
      <img src={assetUrl('3bc79.svg')} alt="넷레이더" />
    </div>
  )
}
