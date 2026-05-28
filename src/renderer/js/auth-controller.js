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

    this.failedAttempts = 0;
    this.lockoutUntil = null;
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
        
        // Rate limit lockout check
        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
          const remaining = Math.ceil((this.lockoutUntil - Date.now()) / 1000);
          alert(`Too many failed attempts. Please try again in ${remaining} seconds.`);
          return;
        }

        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          alert('Invalid email format. Please enter a valid email address.');
          return;
        }

        this.showLoading(true);
        const res = await window.api.signIn(email, password);
        this.showLoading(false);

        if (res.success && res.user) {
          this.failedAttempts = 0;
          this.lockoutUntil = null;
          this.showLoggedIn(res.user);
        } else {
          this.failedAttempts++;
          if (this.failedAttempts >= 5) {
            this.lockoutUntil = Date.now() + 60000; // 60s lockout
            alert('Too many failed attempts. You have been locked out for 60 seconds.');
          } else {
            alert('Sign In Failed: Invalid email or password.');
          }
        }
      });
    }

    // Email sign-up submit
    if (this.signupForm) {
      this.signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          alert('Invalid email format. Please enter a valid email address.');
          return;
        }

        // Password strength check
        // Minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
        if (!passwordRegex.test(password)) {
          alert('Password too weak. It must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.');
          return;
        }

        this.showLoading(true);
        const res = await window.api.signUp(email, password);
        this.showLoading(false);

        if (res.success) {
          alert('Account created! Please check your email for confirmation or sign in.');
          if (this.toggleSignin) this.toggleSignin.click();
        } else {
          alert('Sign Up Failed: ' + (res.error || 'Check signup details.'));
        }
      });
    }

    // Google login
    if (this.googleBtn) {
      this.googleBtn.addEventListener('click', async () => {
        this.showLoading(true, 'Waiting for browser authentication...');
        
        // Start a 5-minute OAuth timeout timer
        if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
        this.oauthTimeout = setTimeout(() => {
          this.showLoading(false);
          alert('Google Sign-In timed out. Please try again.');
        }, 5 * 60 * 1000);

        const res = await window.api.signInWithGoogle();
        if (!res.success) {
          this.showLoading(false);
          if (this.oauthTimeout) {
            clearTimeout(this.oauthTimeout);
            this.oauthTimeout = null;
          }
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

  showLoading(isLoading, text = 'Verifying credentials...') {
    if (this.loadingState) {
      const textContainer = this.loadingState.querySelector('.settings-loading-row');
      if (textContainer) {
        textContainer.innerHTML = `
          <span class="auth-spinner" style="border: 2px solid var(--border-medium); border-top-color: var(--accent-primary); border-radius: 50%; width: 14px; height: 14px; display: inline-block; animation: spin 1s linear infinite;"></span>
          ${text}
        `;
      }
      this.loadingState.style.display = isLoading ? 'block' : 'none';
    }
  }

  showLoggedIn(user) {
    if (this.oauthTimeout) {
      clearTimeout(this.oauthTimeout);
      this.oauthTimeout = null;
    }
    if (this.loggedOutView && this.loggedInView) {
      this.loggedOutView.style.display = 'none';
      this.loggedInView.style.display = 'block';

      if (this.profileEmail) this.profileEmail.innerText = user.email || 'Google User';
      if (this.profileId) this.profileId.innerText = `ID: ${user.id}`;
      if (this.profileAvatar) {
        const letter = (user.email || 'U').charAt(0).toUpperCase();
        this.profileAvatar.innerText = letter;
      }

      // Dispatch global authentication change event
      window.dispatchEvent(new CustomEvent('app:auth-changed', { detail: { isAuthenticated: true, user } }));
    }
  }

  showLoggedOut() {
    if (this.oauthTimeout) {
      clearTimeout(this.oauthTimeout);
      this.oauthTimeout = null;
    }
    if (this.loggedOutView && this.loggedInView) {
      this.loggedOutView.style.display = 'block';
      this.loggedInView.style.display = 'none';
      
      // Clear forms
      if (this.signinForm) this.signinForm.reset();
      if (this.signupForm) this.signupForm.reset();

      // Dispatch global authentication change event
      window.dispatchEvent(new CustomEvent('app:auth-changed', { detail: { isAuthenticated: false } }));
    }
  }
}

export const auth = new AuthController();
