const Auth = (() => {
  async function login(empid, password) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(String(empid || '').trim()) || !password) {
      throw new Error('Enter a valid Employee ID and password.');
    }
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: `${empid.trim().toLowerCase()}@caddtech.com`,
      password
    });
    if (error || !data.user) throw new Error('Invalid Employee ID or password.');
    const profile = await Session.getProfile();
    if (!profile) {
      await supabaseClient.auth.signOut();
      throw new Error('Your account is not provisioned. Contact HR.');
    }
    return { user: data.user, profile };
  }

  async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw new Error('Unable to sign out. Please try again.');
    window.location.href = 'login.html';
  }

  return { login, logout };
})();
