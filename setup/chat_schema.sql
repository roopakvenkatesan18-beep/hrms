-- =========================================================
-- Supabase schema for Team Chat feature (v2)
-- Stores both participants; shows ALL profiles in sidebar
-- =========================================================

-- Drop old version if exists
DROP TABLE IF EXISTS employee_chat_messages;
DROP TABLE IF EXISTS employee_chat_conversations;

-- 1. Conversations table — stores BOTH participants
CREATE TABLE IF NOT EXISTS employee_chat_conversations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user2_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate conversations between the same two people
-- We enforce user1_id < user2_id in app code so (A,B) == (B,A)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_pair
    ON employee_chat_conversations (user1_id, user2_id);

-- 2. Messages table
CREATE TABLE IF NOT EXISTS employee_chat_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES employee_chat_conversations(id) ON DELETE CASCADE,
    sender_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3. Index for fast message retrieval
CREATE INDEX IF NOT EXISTS idx_msg_conv_time
    ON employee_chat_messages (conversation_id, created_at ASC);

-- =========================================================
-- 4. Row‑Level Security (RLS)
-- =========================================================

ALTER TABLE employee_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_chat_messages      ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read ALL profiles (needed for sidebar listing)
-- NOTE: profiles table RLS must already allow SELECT for authenticated users.

-- Users can SELECT conversations they are part of (either side)
CREATE POLICY "users_select_own_conversations"
    ON employee_chat_conversations
    FOR SELECT
    USING (user1_id = auth.uid() OR user2_id = auth.uid());

-- Users can INSERT a conversation (they must be one of the two participants)
CREATE POLICY "users_insert_conversations"
    ON employee_chat_conversations
    FOR INSERT
    WITH CHECK (user1_id = auth.uid() OR user2_id = auth.uid());

-- Users can SELECT messages in conversations they belong to
CREATE POLICY "users_select_messages"
    ON employee_chat_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employee_chat_conversations c
            WHERE c.id = conversation_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
    );

-- Users can INSERT messages only into their own conversations (as the sender)
CREATE POLICY "users_insert_messages"
    ON employee_chat_messages
    FOR INSERT
    WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM employee_chat_conversations c
            WHERE c.id = conversation_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
    );

-- =========================================================
-- 5. profiles SELECT policy (if not already set)
--    Allows all authenticated users to see each other's profiles
--    (required for showing names in the chat sidebar)
-- =========================================================
DROP POLICY IF EXISTS "Anyone authenticated can view all profiles" ON public.profiles;
CREATE POLICY "Anyone authenticated can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ( true );

-- =========================================================
-- 6. DELETE policies
--    Without these, RLS blocks every delete and messages can
--    never be removed (even your own).
-- =========================================================

-- Users can DELETE their own messages only
DROP POLICY IF EXISTS "users_delete_own_messages" ON employee_chat_messages;
CREATE POLICY "users_delete_own_messages"
  ON employee_chat_messages
  FOR DELETE
  USING ( sender_id = auth.uid() );

-- Participants can DELETE a conversation they belong to
-- (cascade removes its messages too)
DROP POLICY IF EXISTS "users_delete_own_conversations" ON employee_chat_conversations;
CREATE POLICY "users_delete_own_conversations"
  ON employee_chat_conversations
  FOR DELETE
  USING ( user1_id = auth.uid() OR user2_id = auth.uid() );
