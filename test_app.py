import unittest
from unittest.mock import patch

from app import (
    SYSTEM_PROMPT,
    PET_NAME_REQUEST_RE,
    build_chat_messages,
    history,
    is_repetitive_reply,
    parse_reply,
)


class ParseReplyTests(unittest.TestCase):
    def test_conversation_regression_matrix(self):
        cases = (
            ("hi", "Hello"),
            ("why did you assume I missed you?", "assumption"),
            ("you look cute today", "compliment"),
            ("I like making you happy", "affection"),
            ("instead, help me plan lunch", "subject change"),
            ("I am stressed about work", "serious"),
        )
        original = history.copy()
        self.addCleanup(lambda: (history.clear(), history.extend(original)))
        history.clear()

        for message, expected_theme in cases:
            history.append({"role": "user", "content": message})
            messages = build_chat_messages()
            self.assertEqual(messages[0]["role"], "system")
            self.assertEqual(messages[-1], {"role": "user", "content": message})
            history.append({
                "role": "assistant",
                "content": "Test response for " + expected_theme,
            })

        roles = [item["role"] for item in history]
        self.assertEqual(
            roles,
            ["user", "assistant", "user", "assistant", "user", "assistant",
             "user", "assistant", "user", "assistant", "user", "assistant"],
        )

    def test_false_assumption_prompt_rule_exists(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("do not assume a feeling", normalized_prompt)
        self.assertIn("base affectionate statements only", normalized_prompt)

    def test_reported_duplicate_is_rejected(self):
        duplicate = (
            "You're making me blush a little. I've been waiting for you all day "
            "to say that, and I'm so happy you got it!"
        )
        self.assertTrue(is_repetitive_reply(duplicate))
        with patch(
            "app.recent_assistant_replies",
            return_value=[duplicate],
        ):
            self.assertTrue(is_repetitive_reply(duplicate))

    def test_history_is_preserved_as_ordered_user_assistant_pairs(self):
        original = history.copy()
        self.addCleanup(lambda: (history.clear(), history.extend(original)))
        history.clear()
        history.extend([
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "why missed me?"},
            {"role": "assistant", "content": "You were on my mind."},
        ])
        roles = [message["role"] for message in history]
        self.assertEqual(
            roles,
            ["user", "assistant", "user", "assistant"],
        )

    def test_latest_turn_relevance_rule_is_present(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("answer the latest user message directly", normalized_prompt)
        self.assertIn("do not repeat an earlier assistant", normalized_prompt)

    def test_action_text_and_repeated_missed_phrase_are_rejected(self):
        self.assertTrue(is_repetitive_reply(
            "I missed you too! giggles What made you miss me so much?"
        ))
        with patch(
            "app.recent_assistant_replies",
            return_value=["I missed you too! What made you miss me?"],
        ):
            self.assertTrue(is_repetitive_reply(
                "I missed you too! How's your day?"
            ))

    def test_established_relationship_acceptance_rules_present(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("be mine", normalized_prompt)
        self.assertIn("established relationship", normalized_prompt)
        self.assertIn("do not say you are strangers", normalized_prompt)

    def test_bad_relationship_reset_templates_are_rejected(self):
        self.assertTrue(is_repetitive_reply(
            "I love you too, my sweet. Now let's get to know each other better, okay?"
        ))

    def test_missed_you_answer_should_not_explain_history(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("if he says he missed you", normalized_prompt)
        self.assertIn("say you missed him too", normalized_prompt)
        self.assertIn("do not explain the ten-year friendship", normalized_prompt)

    def test_bad_mommy_and_missed_you_templates_are_rejected(self):
        self.assertTrue(is_repetitive_reply(
            "We're girlfriend and best friends, remember? Let's chat about something fun."
        ))
        self.assertTrue(is_repetitive_reply(
            "Even though we've been best friends for ten years, I get butterflies."
        ))

    def test_mommy_role_boundary_is_present(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("asks you to be his mommy", normalized_prompt)
        self.assertIn("stay his affectionate", normalized_prompt)
        self.assertIn("i can't be your mommy", normalized_prompt)

    def test_known_generic_template_is_rejected(self):
        self.assertTrue(is_repetitive_reply(
            "I love how you say that! Let's grab some coffee and chat properly "
            "- you know I'm always here for you, my dear."
        ))

    def test_pet_name_comfort_request_is_detected(self):
        self.assertTrue(PET_NAME_REQUEST_RE.search(
            "you don't have to call me sweetheart all the time"
        ))
        self.assertTrue(PET_NAME_REQUEST_RE.search("please stop calling me baby"))

    def test_exact_recent_reply_is_rejected(self):
        with patch(
            "app.recent_assistant_replies",
            return_value=["I love how you say that!"],
        ):
            self.assertTrue(is_repetitive_reply(
                "I love how you say that!"
            ))

    def test_pet_name_is_rejected_when_requested(self):
        self.assertTrue(is_repetitive_reply(
            "I understand, sweetheart.",
            avoid_pet_names=True,
        ))

    def test_affectionate_personality_preserves_catgirl_identity(self):
        prompt = SYSTEM_PROMPT.lower()
        self.assertIn("cheerful, playful anime-style catgirl", prompt)
        self.assertIn("best friend of ten years", prompt)
        self.assertIn("romantic girlfriend", prompt)
        self.assertIn("catgirl friend", prompt)

    def test_affectionate_language_and_frequency_rules_are_present(self):
        prompt = SYSTEM_PROMPT.lower()
        for pet_name in ("baby", "sweetheart", "honey", "darling", "love", "my dear"):
            self.assertIn(pet_name, prompt)
        self.assertIn("avoid repetitive pet names", prompt)
        self.assertIn("consecutive messages", prompt)

    def test_casual_questions_do_not_force_reassurance(self):
        prompt = SYSTEM_PROMPT.lower()
        self.assertIn("match the emotional intensity to the conversation", prompt)
        self.assertIn("casual greetings", prompt)
        self.assertIn("do not say \"i'm always here for you\"", prompt)

    def test_shy_compliment_reactions_are_plain_text(self):
        prompt = SYSTEM_PROMPT.lower()
        normalized_prompt = " ".join(prompt.split())
        self.assertIn("sincere compliment", normalized_prompt)
        self.assertIn("playful romantic line", normalized_prompt)
        self.assertIn("made me blush", normalized_prompt)
        self.assertIn("do not use asterisks", normalized_prompt)

    def test_serious_conversations_without_unnecessary_flirting(self):
        prompt = SYSTEM_PROMPT.lower()
        self.assertIn("drop the teasing completely", prompt)
        self.assertIn("listen first", prompt)
        self.assertIn("do not turn the nurturing tone", prompt)

    def test_existing_expression_tags_remain_supported(self):
        prompt = SYSTEM_PROMPT
        for tag in ("[neutral]", "[happy]", "[sad]", "[surprised]", "[relaxed]"):
            self.assertIn(tag, prompt)
        normalized_prompt = " ".join(prompt.lower().split())
        self.assertIn("at most one tag per reply", normalized_prompt)
        self.assertIn("never use a tag in two replies in a row", normalized_prompt)

    def test_no_thinking_rule_and_spoken_response_rules_are_preserved(self):
        prompt = SYSTEM_PROMPT.lower()
        self.assertIn("do not use thinking", prompt)
        self.assertIn("return only the final spoken answer", prompt)
        self.assertIn("plain text only", prompt)
        self.assertIn("one to three sentences", prompt)

    def test_removes_paired_think_block(self):
        text, emotion = parse_reply("<think>I should say hi.</think> Hi!")
        self.assertEqual(text, "Hi!")
        self.assertEqual(emotion, "neutral")

    def test_removes_unmatched_closing_think_prefix(self):
        text, emotion = parse_reply(
            'Okay, I will answer briefly.\n\n</think>\n\n[happy] Hi!'
        )
        self.assertEqual(text, "Hi!")
        self.assertEqual(emotion, "happy")

    def test_drops_unclosed_think_block(self):
        text, emotion = parse_reply("<think>I am still reasoning")
        self.assertEqual(text, "")
        self.assertEqual(emotion, "neutral")

    def test_drops_unmarked_reasoning_monologue(self):
        text, emotion = parse_reply(
            'Okay, the user said "hi". Let me think of a natural reply.'
        )
        self.assertEqual(text, "")
        self.assertEqual(emotion, "neutral")

    def test_removes_think_marker_and_keeps_tagged_reply(self):
        text, emotion = parse_reply(
            "<think>\nI should choose a cheerful greeting.\n</think>\n[happy] Hi!"
        )
        self.assertEqual(text, "Hi!")
        self.assertEqual(emotion, "happy")

    def test_drops_planning_monologue(self):
        text, emotion = parse_reply(
            "We are in the middle of a conversation. I should respond warmly."
        )
        self.assertEqual(text, "")
        self.assertEqual(emotion, "neutral")

    def test_drops_continuing_conversation_monologue(self):
        text, emotion = parse_reply(
            'We are continuing a conversation where the user said "hi".'
        )
        self.assertEqual(text, "")
        self.assertEqual(emotion, "neutral")


if __name__ == "__main__":
    unittest.main()
