/* ============================================================
   CADD Tech HRMS — Role Guard
   Protects pages by requiring authentication and role match
   ============================================================ */

const RoleGuard = (() => {

  /**
   * Require authentication and check role authorization
   * Call this at the top of every protected page's DOMContentLoaded handler
   * 
   * @param {string[]} allowedRoles - Array of roles allowed to view this page, e.g., ['hr'] or ['employee']
   * @returns {Promise<object>} The user's profile if authorized
   * 
   * Side effects:
   * - Redirects to login.html if not authenticated
   * - Redirects to unauthorized.html if role mismatch
   * - Shows page content (removes loading skeleton) when authorized
   */
  async function requireAuth(allowedRoles) {
    try {
      // Show loading state
      showLoadingSkeleton();

      // Check for active session
      const session = await Session.getSession();
      if (!session) {
        window.location.href = 'login.html';
        // Return a never-resolving promise to prevent page code from running
        return new Promise(() => {});
      }

      // Fetch user profile
      const profile = await Session.getProfile();
      if (!profile) {
        // Session exists but no profile — corrupted state
        await Auth.logout();
        return new Promise(() => {});
      }

      // Check role authorization
      if (allowedRoles && allowedRoles.length > 0) {
        if (!allowedRoles.includes(profile.role)) {
          window.location.href = 'unauthorized.html';
          return new Promise(() => {});
        }
      }

      // Authorized — hide loading skeleton, show page content
      hideLoadingSkeleton();

      // Set up auth state listener for session expiry
      Session.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          window.location.href = 'login.html';
        }
      });

      return profile;

    } catch (err) {
      console.error('[RoleGuard] requireAuth error:', err.message);
      window.location.href = 'login.html';
      return new Promise(() => {});
    }
  }

  /**
   * Show a loading skeleton overlay while checking auth
   */
  function showLoadingSkeleton() {
    // Check if skeleton already exists
    if (document.getElementById('auth-loading-skeleton')) return;

    const skeleton = document.createElement('div');
    skeleton.id = 'auth-loading-skeleton';
    skeleton.innerHTML = `
      <div class="auth-skeleton-inner">
        <div class="auth-skeleton-logo">
          <div class="skeleton-pulse" style="width:48px;height:48px;border-radius:12px"></div>
          <div>
            <div class="skeleton-pulse" style="width:120px;height:16px;border-radius:4px"></div>
            <div class="skeleton-pulse" style="width:60px;height:12px;border-radius:4px;margin-top:6px"></div>
          </div>
        </div>
        <div class="auth-skeleton-spinner">
          <svg class="auth-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          <span style="color:#64748b;font-size:0.875rem;font-weight:500">Verifying access...</span>
        </div>
      </div>
    `;
    document.body.appendChild(skeleton);

    // Hide the main app content
    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.display = 'none';
  }

  /**
   * Hide the loading skeleton and show page content
   */
  function hideLoadingSkeleton() {
    const skeleton = document.getElementById('auth-loading-skeleton');
    if (skeleton) {
      skeleton.classList.add('fade-out');
      setTimeout(() => skeleton.remove(), 300);
    }

    // Show the main app content
    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.display = 'flex';
  }

  return {
    requireAuth
  };

})();
