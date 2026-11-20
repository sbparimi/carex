"""Collection workflow contracts, plus runtime API MFA regression."""
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.mark.parametrize('filename', ['CareX-REST-API', 'CareX-Udemy-Training'])
def test_postman_fresh_run_authentication_order_and_token_lifecycle(filename):
    collection = json.loads((ROOT / 'postman' / (filename + '.postman_collection.json')).read_text())
    requests = [item for folder in collection['item'] for item in folder['item']]
    names = [item['name'] for item in requests]
    lookup = {item['name']: item for item in requests}
    def script(name, kind):
        return '\n'.join(line for event in lookup[name].get('event', []) if event['listen'] == kind for line in event['script']['exec'])
    assert names.index('Patient login') < names.index('Patient token status') < names.index('List appointments')
    assert names.index('Staff login') < names.index('Staff token status') < names.index('Staff catalog')
    assert names.index('Update notification preferences') < names.index('Logout patient')
    assert names.index('List clinics') < names.index('Clinic visit types')
    for name, token in [('Patient login', 'patientToken'), ('Staff login', 'staffToken')]:
        before = script(name, 'prerequest')
        assert f"pm.environment.unset('{token}')" in before
        if name == 'Patient login':
            assert "pm.environment.unset('mfaChallenge')" in before
            assert "pm.collectionVariables.unset('mfaChallenge')" in before
        assert f"pm.collectionVariables.unset('{token}')" in before
        after = script(name, 'test')
        assert f"pm.environment.set('{token}'" in after
        assert f"pm.collectionVariables.set('{token}'" in after
    if filename == 'CareX-Udemy-Training':
        assert names.index('Patient login') < names.index('Verify MFA challenge') < names.index('Patient token status')
        assert names.index('Logout patient') < names.index('Request password reset') < names.index('Confirm password reset')
        after = script('Verify MFA challenge', 'test')
        assert "pm.environment.set('patientToken'" in after
        assert "pm.collectionVariables.set('patientToken'" in after
        assert 'data.access_token' in after


def test_mfa_token_can_fetch_appointments_and_is_revoked_on_logout(client, ctx):
    from conftest import S
    ctx.db.run("UPDATE tenants SET mfa_required = 1 WHERE id = 'tn-north'")
    signup = client.post(S + '/api/v1/auth/signup', json={
        'email': 'mfa.collection@example.test', 'password': 'Synthetic-Run-Passw0rd-2026',
        'first_name': 'Collection', 'last_name': 'MFA', 'date_of_birth': '1990-02-03',
        'phone': '555-123-4567', 'access_type': 'employer', 'access_id': 'em-n-1'})
    assert signup.status_code == 201
    login = client.post(S + '/api/v1/auth/login', json={
        'email': 'mfa.collection@example.test', 'password': 'Synthetic-Run-Passw0rd-2026'})
    assert login.status_code == 202
    assert 'access_token' not in login.json()
    verified = client.post(S + '/api/v1/auth/mfa/verify', json={
        'challenge': login.json()['challenge'], 'code': ctx.accounts.mailer.codes[-1][1]})
    assert verified.status_code == 200
    headers = {'Authorization': 'Bearer ' + verified.json()['access_token']}
    assert client.get(S + '/api/v1/appointments', headers=headers).status_code == 200
    assert client.post(S + '/api/v1/auth/logout', headers=headers).status_code == 204
    assert client.get(S + '/api/v1/appointments', headers=headers).status_code == 401
