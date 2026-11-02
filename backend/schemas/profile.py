
from typing import Literal

from pydantic import BaseModel, Field


class FavoritePlace(BaseModel):
    id: str
    label: str
    address: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    kind: Literal["home", "lpg", "ev", "custom"]


class UserProfile(BaseModel):
    name: str
    vehicleType: str
    notifications: bool
    favorites: list[FavoritePlace]
