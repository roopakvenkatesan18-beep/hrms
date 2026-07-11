/* ============================================================
   CADD Tech HRMS — Session Management
   Handles Supabase session state, profile fetching, auto-login
   ============================================================ */

const Session = (() => {

  /**
   * Get the current Supabase session
   * @returns {Promise<object|null>} Session object or null
   */
  async function getSession() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      return session;
    } catch (err) {
      console.error('[Session] getSession error:', err.message);
      return null;
    }
  }

  /**
   * Get the current authenticated user
   * @returns {Promise<object|null>} User object or null
   */
  async function getUser() {
    try {
      const { data: { user }, error } = await supabaseClient.auth.getUser();
      if (error) throw error;
      return user;
    } catch (err) {
      console.error('[Session] getUser error:', err.message);
      return null;
    }
  }

  async function buildFallbackProfile(user) {
    const email = user.email || '';
    const empidMatch = email.match(/^([^@]+)@/);
    const empidExtracted = empidMatch ? empidMatch[1] : '';
    const role = empidExtracted === '0001' ? 'hr' : 'employee';

    let foundName = 'Employee ' + empidExtracted;
    const nameMap = {
      '0001': 'Harikrishnan',
      '0002': 'Chandru',
      '0005': 'Raji',
      '0006': 'Empname0006',
      '0007': 'Empname0007'
    };
    if (nameMap[empidExtracted]) foundName = nameMap[empidExtracted];

    try {
      const { data: attData } = await supabaseClient
        .from('emp_monthly')
        .select('name')
        .eq('empid', empidExtracted)
        .limit(1)
        .single();
      if (attData && attData.name) foundName = attData.name;
    } catch (e) {}

    return {
      id: user.id,
      empid: empidExtracted,
      name: foundName,
      role: role,
      department: 'Training'
    };
  }

  async function getProfile() {
    try {
      const user = await getUser();
      if (!user) return null;

      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        return buildFallbackProfile(user);
      }
      return data;
    } catch (err) {
      console.error('[Session] getProfile error:', err.message);
      return null;
    }
  }

  /**
   * Check if a valid session exists
   * @returns {Promise<boolean>}
   */
  async function isAuthenticated() {
    const session = await getSession();
    return session !== null;
  }

  /**
   * Listen for auth state changes
   * @param {Function} callback - Called with (event, session)
   * @returns {object} Subscription object with unsubscribe method
   */
  function onAuthStateChange(callback) {
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
    return subscription;
  }

  /**
   * Get the appropriate dashboard URL based on user role
   * @param {string} role - 'hr' or 'employee'
   * @returns {string} Dashboard URL
   */
  function getDashboardUrl(role) {
    if (role === 'hr') return 'hr-dashboard.html';
    if (role === 'employee') return 'employee-dashboard.html';
    return 'login.html';
  }

  /**
   * Auto-redirect to dashboard if already logged in
   * Call this on login page to skip login if session exists
   */
  async function autoRedirectIfLoggedIn() {
    try {
      const session = await getSession();
      if (!session) return false;

      const profile = await getProfile();
      if (!profile) return false;

      window.location.href = getDashboardUrl(profile.role);
      return true;
    } catch (err) {
      console.error('[Session] autoRedirect error:', err.message);
      return false;
    }
  }

  return {
    getSession,
    getUser,
    getProfile,
    buildFallbackProfile,
    isAuthenticated,
    onAuthStateChange,
    getDashboardUrl,
    autoRedirectIfLoggedIn
  };

})();
