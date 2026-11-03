# 테스트용 지역별 예측 데이터
# 실제 AI 모델 결과가 아닌 임시 데이터입니다.

MOCK_ZONES = {
    "gangnam": {
        "id": "gangnam",
        "name": "강남역",
        "lat": 37.4979,
        "lng": 127.0276,
        "h3Index": "mock-gangnam",
        "reason": "승객 수요가 높고 예상 순수익이 높은 지역입니다.",
        "pickupProbability": 0.75,
        "trend": [
            {
                "minutes": 0,
                "grossRevenue": 40000,
                "fuelCost": 5000,
                "idleCost": 3000,
                "netHourly": 32000,
                "passengers": 8,
            },
            {
                "minutes": 30,
                "grossRevenue": 38000,
                "fuelCost": 5000,
                "idleCost": 4000,
                "netHourly": 29000,
                "passengers": 7,
            },
            {
                "minutes": 60,
                "grossRevenue": 35000,
                "fuelCost": 5000,
                "idleCost": 5000,
                "netHourly": 25000,
                "passengers": 6,
            },
        ],
    },
    "gyodae": {
        "id": "gyodae",
        "name": "교대역",
        "lat": 37.4934,
        "lng": 127.0145,
        "h3Index": "mock-gyodae",
        "reason": "교통 흐름이 비교적 원활해 이동 비용이 낮은 지역입니다.",
        "pickupProbability": 0.65,
        "trend": [
            {
                "minutes": 0,
                "grossRevenue": 34000,
                "fuelCost": 4000,
                "idleCost": 2000,
                "netHourly": 28000,
                "passengers": 6,
            },
            {
                "minutes": 30,
                "grossRevenue": 36000,
                "fuelCost": 4000,
                "idleCost": 2000,
                "netHourly": 30000,
                "passengers": 7,
            },
            {
                "minutes": 60,
                "grossRevenue": 32000,
                "fuelCost": 4000,
                "idleCost": 3000,
                "netHourly": 25000,
                "passengers": 5,
            },
        ],
    },
}