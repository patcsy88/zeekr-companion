FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/api

COPY pyproject.toml ./
COPY app ./app
# `pip install .` leaves build/ (a stale copy of app/) and *.egg-info in the working directory.
# The app runs from /srv/api/app, so remove them in the same layer.
RUN pip install . && rm -rf build ./*.egg-info

COPY alembic.ini ./
COPY alembic ./alembic
COPY docker-entrypoint.sh ./

# /var/lib/zeekr-geofence is the one writable folder (a named volume in compose, Piece B).
RUN useradd --system --no-create-home --uid 10001 api && chmod +x docker-entrypoint.sh \
    && mkdir -p /var/lib/zeekr-geofence && chown 10001 /var/lib/zeekr-geofence \
    && chmod 700 /var/lib/zeekr-geofence
USER api

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
