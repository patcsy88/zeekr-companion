from __future__ import annotations

import uuid

from app.errors import Conflict, NotFound
from app.repositories.vehicle import VehicleRepository
from app.schemas import VehicleIn, VehicleOut


class VehicleService:
    def __init__(self, repo: VehicleRepository) -> None:
        self._repo = repo

    def get(self) -> VehicleOut:
        vehicle = self._repo.get()
        if vehicle is None:
            raise NotFound("No vehicle profile has been created yet.")
        return VehicleOut.model_validate(vehicle)

    def put(self, data: VehicleIn) -> VehicleOut:
        existing = self._repo.get()
        if existing is not None and data.id is not None and data.id != existing.id:
            raise Conflict("The vehicle profile already exists with a different id.")
        vehicle_id = existing.id if existing is not None else (data.id or uuid.uuid4())
        values = data.model_dump(exclude={"id"})
        return VehicleOut.model_validate(self._repo.upsert(vehicle_id, values))
