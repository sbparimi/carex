import unittest
from policy_gate import validate_proposal

class PolicyGateTests(unittest.TestCase):
    def proposal(self):
        return {
            "change_id": "CAREX-214",
            "source_revision": "demo-v2",
            "proposed_actions": [
                {"action": "read_contract", "evidence_ref": "openapi:demo"}
            ],
            "release_decision": "recommend_review",
        }

    def test_evidence_backed_read_is_valid_for_review(self):
        self.assertEqual(validate_proposal(self.proposal()), [])

    def test_write_action_blocked_without_human_approval(self):
        p = self.proposal()
        p["proposed_actions"].append({"action": "update_collection"})
        self.assertTrue(any("human approval required" in e
                            for e in validate_proposal(p)))

    def test_unknown_action_is_rejected(self):
        p = self.proposal()
        p["proposed_actions"].append({"action": "send_customer_email"})
        self.assertTrue(any("not allow-listed" in e for e in validate_proposal(p)))

    def test_release_approval_is_not_an_agent_output(self):
        p = self.proposal()
        p["release_decision"] = "approve_release"
        self.assertTrue(any("cannot approve" in e for e in validate_proposal(p)))

    def test_missing_evidence_is_rejected(self):
        p = self.proposal()
        p["proposed_actions"] = [{"action": "read_contract"}]
        self.assertTrue(any("requires evidence_ref" in e
                            for e in validate_proposal(p)))

if __name__ == "__main__":
    unittest.main()
