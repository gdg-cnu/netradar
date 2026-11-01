import { assetUrl } from "../../utils/assets"

export default function LocationModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-title"
    >
      <div className="location-modal">
        <div className="modal-copy">
          <h2 id="location-title">
            ‘넷레이더' 앱이 사용자의 위치를
            <br />
            사용하도록 허용하겠습니까?
          </h2>
          <p>
            사용자의 위치는 넷레이더에서
            <br />
            사용자의 위치를 표시하고, 경로를 가져오며,
            <br />
            이동 시간을 예측하고, 검색 결과를
            <br />
            향상하는데 사용됩니다.
          </p>
        </div>
        <div className="permission-map">
          <img src={assetUrl("75b15.png")} alt="교대역 주변 지도" />
          <span className="current-pin">내 위치</span>
        </div>
        {["한 번 허용", "앱을 사용하는 동안 허용", "허용 안 함"].map(
          (label) => (
            <button key={label} onClick={onClose}>
              {label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
