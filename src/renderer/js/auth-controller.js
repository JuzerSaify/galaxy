import { state } from './state.js';

class AuthController {
  constructor() {
    this.loadingState = null;
    this.loggedOutView = null;
    this.loggedInView = null;
    this.signinForm = null;
    this.signupForm = null;
    this.toggleSignin = null;
    this.toggleSignup = null;
    this.googleBtn = null;
    this.signoutBtn = null;

    this.profileEmail = null;
    this.profileId = null;
    this.profileAvatar = null;
  }

  async init() {
    this.loadingState = document.getElementById('auth-loading-state');
    this.loggedOutView = document.getElementById('auth-logged-out-view');
    this.loggedInView = document.getElementById('auth-logged-in-view');
    this.signinForm = document.getElementById('auth-signin-form');
    this.signupForm = document.getElementById('auth-signup-form');
    this.toggleSignin = document.getElementById('toggle-signin-mode');
    this.toggleSignup = document.getElementById('toggle-signup-mode');
    this.googleBtn = document.getElementById('google-signin-btn');
    this.signoutBtn = document.getElementById('auth-signout-btn');

    this.profileEmail = document.getElementById('user-profile-email');
    this.profileId = document.getElementById('user-profile-id');
    this.profileAvatar = document.getElementById('user-profile-avatar');

    this.setupEventListeners();
    
    // Check initial status on load
    await this.checkStatus();

    // Listen to deep-link login callback from main process
    if (window.api && window.api.onAuthStatusChanged) {
      window.api.onAuthStatusChanged((status) => {
        console.log('[auth] Status changed received from main process:', status);
        if (status.isAuthenticated && status.user) {
          this.showLoggedIn(status.user);
        } else {
          this.showLoggedOut();
        }
      });
    }
  }

  async checkStatus() {
    this.showLoading(true);
    try {
      const status = await window.api.getUser();
      if (status.isAuthenticated && status.user) {
        this.showLoggedIn(status.user);
      } else {
        this.showLoggedOut();
      }
    } catch (e) {
      this.showLoggedOut();
    } finally {
      this.showLoading(false);
    }
  }

  setupEventListeners() {
    // Toggle login/signup tabs
    if (this.toggleSignin && this.toggleSignup) {
      this.toggleSignin.addEventListener('click', () => {
        this.toggleSignin.classList.add('active');
        this.toggleSignup.classList.remove('active');
        this.toggleSignin.style.color = 'var(--text-primary)';
        this.toggleSignup.style.color = 'var(--text-secondary)';
        this.signinForm.style.display = 'flex';
        this.signupForm.style.display = 'none';
      });

      this.toggleSignup.addEventListener('click', () => {
        this.toggleSignup.classList.add('active');
        this.toggleSignin.classList.remove('active');
        this.toggleSignup.style.color = 'var(--text-primary)';
        this.toggleSignin.style.color = 'var(--text-secondary)';
        this.signupForm.style.display = 'flex';
        this.signinForm.style.display = 'none';
      });
    }

    // Email sign-in submit
    if (this.signinForm) {
      this.signinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;

        this.showLoading(true);
        const res = await window.api.signIn(email, password);
        this.showLoading(false);

        if (res.success && res.user) {
          this.showLoggedIn(res.user);
        } else {
          alert('Sign In Failed: ' + (res.error || 'Check your credentials'));
        }
      });
    }

    // Email sign-up submit
    if (this.signupForm) {
      this.signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        this.showLoading(true);
        const res = await window.api.signUp(email, password);
        this.showLoading(false);

        if (res.success) {
          alert('Account created! Please check your email for confirmation or sign in.');
          if (this.toggleSignin) this.toggleSignin.click();
        } else {
          alert('Sign Up Failed: ' + (res.error || 'Password must be at least 6 characters'));
        }
      });
    }

    // Google login
    if (this.googleBtn) {
      this.googleBtn.addEventListener('click', async () => {
        this.showLoading(true);
        const res = await window.api.signInWithGoogle();
        this.showLoading(false);
        if (!res.success) {
          alert('Failed to launch Google Sign In: ' + res.error);
        }
      });
    }

    // Sign out
    if (this.signoutBtn) {
      this.signoutBtn.addEventListener('click', async () => {
        this.showLoading(true);
        const res = await window.api.signOut();
        this.showLoading(false);

        if (res.success) {
          this.showLoggedOut();
        } else {
          alert('Sign Out Failed: ' + res.error);
        }
      });
    }
  }

  showLoading(isLoading) {
    if (this.loadingState) {
      this.loadingState.style.display = isLoading ? 'block' : 'none';
    }
  }

  showLoggedIn(user) {
    if (this.loggedOutView && this.loggedInView) {
      this.loggedOutView.style.display = 'none';
      this.loggedInView.style.display = 'block';

      if (this.profileEmail) this.profileEmail.innerText = user.email || 'Google User';
      if (this.profileId) this.profileId.innerText = `ID: ${user.id}`;
      if (this.profileAvatar) {
        const letter = (user.email || 'U').charAt(0).toUpperCase();
        this.profileAvatar.innerText = letter;
      }
    }
  }

  showLoggedOut() {
    if (this.loggedOutView && this.loggedInView) {
      this.loggedOutView.style.display = 'block';
      this.loggedInView.style.display = 'none';
      
      // Clear forms
      if (this.signinForm) this.signinForm.reset();
      if (this.signupForm) this.signupForm.reset();
    }
  }
}

export const auth = new AuthController();
