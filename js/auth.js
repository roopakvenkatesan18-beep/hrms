/* ============================================================
   CADD Tech HRMS — Authentication Logic
   Login, logout, and credential handling
   ============================================================ */

const Auth = (() => {

  /**
   * Log in with Employee ID and password
   * @param {string} empid - Employee ID (e.g., '0001')
   * @param {string} password - Password
   * @returns {Promise<{user: object, profile: object}>} User and profile data
   * @throws {Error} With user-friendly message
   */
  async function login(empid, password) {
    // Validate inputs
    if (!empid || !empid.trim()) {
      throw new Error('Please enter your Employee ID');
    }
    if (!password) {
      throw new Error('Please enter your password');
    }

    // Convert EMPID to email format
    const email = `${empid.trim()}@caddtech.com`;

    try {
      // Authenticate with Supabase
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) {
        // Map Supabase errors to user-friendly messages
        if (error.message.includes('Invalid login credentials')) {
          throw new Error('Invalid Employee ID or password');
        }
        if (error.message.includes('Email not confirmed')) {
          throw new Error('Account not verified. Contact HR.');
        }
        if (error.message.includes('Too many requests')) {
          throw new Error('Too many attempts. Please wait a moment.');
        }
        throw new Error(error.message);
      }

      if (!data.user) {
        throw new Error('Authentication failed. Please try again.');
      }

      let profile;
      try {
        const { data: fetchedProfile, error: profileError } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError) throw profileError;
        profile = fetchedProfile;
      } catch (err) {
        console.warn('[Auth] Database profile fetch failed, using local fallback:', err.message);
        profile = await Session.buildFallbackProfile(data.user);
      }

      return { user: data.user, profile };

    } catch (err) {
      console.error('[Auth] login error:', err);
      throw new Error(err.message || 'Unknown error occurred');
    }
  }

  /**
   * Log out the current user
   * Clears Supabase session and redirects to login page
   */
  async function logout() {
    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.error('[Auth] logout error:', err.message);
    }
    // Always redirect, even if signOut errors
    window.location.href = 'login.html';
  }

  return {
    login,
    logout
  };

})();
