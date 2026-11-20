from __future__ import annotations

from urllib.parse import urlparse


def test_openapi_exposes_versioned_rest_api(client):
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/t/{slug}/api/v1/auth/login" in paths
    assert "/t/{slug}/api/v1/appointments" in paths
    assert "/t/{slug}/api/v1/staff/appointments/{appointment_id}/status" in paths
    assert "/t/{slug}/api/v1/availability" in paths


def test_patient_api_booking_lifecycle(client):
    base = "/t/northwind-health/api/v1"
    signup = client.post(base + "/auth/signup", json={
        "email": "api.patient@example.com", "password": "correct horse 1",
        "first_name": "API", "last_name": "Patient", "date_of_birth": "1990-02-03",
        "phone": "555-123-4567", "access_type": "employer", "access_id": "em-n-1"
    })
    assert signup.status_code == 201, signup.text
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    clinics = client.get(base + "/clinics", params={"q": "San Bernardo"})
    assert clinics.status_code == 200
    clinic_id = clinics.json()["clinics"][0]["id"]
    services = client.get(f"{base}/clinics/{clinic_id}/visit-types", headers=headers).json()["visit_types"]
    service_id = services[0]["id"]
    provider_response = client.get(f"{base}/clinics/{clinic_id}/providers", params={"visit_type_id": service_id})
    assert provider_response.status_code == 200
    provider_id = provider_response.json()["providers"][0]["id"]
    slots = client.get(base + "/availability", params={
        "clinic_id": clinic_id, "visit_type_id": service_id, "provider_id": provider_id
    }, headers=headers)
    assert slots.status_code == 200 and slots.json()["slots"]
    slot_id = slots.json()["slots"][0]["id"]

    booking = client.post(base + "/appointments", headers={**headers, "Idempotency-Key": "api-course-booking-001"}, json={
        "clinic_id": clinic_id, "service_id": service_id, "provider_id": provider_id,
        "slot_id": slot_id, "reason": "Routine appointment", "modality": "in_person",
        "consent_version": "v1"
    })
    assert booking.status_code == 201, booking.text
    appointment_id = booking.json()["booking_id"]
    assert booking.json()["status"] == "confirmed"

    listed = client.get(base + "/appointments", headers=headers)
    assert listed.status_code == 200
    assert any(x["booking_id"] == appointment_id for x in listed.json()["appointments"])

    cancelled = client.post(f"{base}/appointments/{appointment_id}/cancel", headers=headers, json={"reason": "Course test cleanup"})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
