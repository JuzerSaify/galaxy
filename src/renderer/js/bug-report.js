class BugReportController {
  constructor() {
    this.triggerBtn = null;
    this.overlay = null;
    this.closeBtn = null;
    this.cancelBtn = null;
    this.form = null;
  }

  init() {
    this.triggerBtn = document.getElementById('bug-report-trigger-btn');
    this.overlay = document.getElementById('bug-report-view');
    this.closeBtn = document.getElementById('bug-report-close-trigger');
    this.cancelBtn = document.getElementById('bug-report-cancel-btn');
    this.form = document.getElementById('bug-report-form');

    this.setupEventListeners();
  }

  setupEventListeners() {
    if (this.triggerBtn) {
      this.triggerBtn.addEventListener('click', async () => {
        this.open();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.close();
      });
    }

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => {
        this.close();
      });
    }

    // Close when clicking outside modal body
    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });
    }

    if (this.form) {
      this.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('bug-title').value.trim();
        const description = document.getElementById('bug-desc').value.trim();
        const email = document.getElementById('bug-email').value.trim();

        const submitBtn = this.form.querySelector('button[type="submit"]');
        const origText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = 'Submitting...';

        try {
          const res = await window.api.submitBugReport(title, description, email);
          if (res.success) {
            alert('Bug report submitted successfully! Thank you for helping us improve Galaxy.');
            this.close();
          } else {
            alert('Failed to submit report: ' + (res.error || 'Unknown error occurred'));
          }
        } catch (err) {
          alert('Error submitting report: ' + err.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerText = origText;
        }
      });
    }
  }

  async open() {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
      
      // Auto pre-fill user email if authenticated
      const emailInput = document.getElementById('bug-email');
      if (emailInput) {
        try {
          const status = await window.api.getUser();
          if (status.isAuthenticated && status.user && status.user.email) {
            emailInput.value = status.user.email;
          } else {
            emailInput.value = '';
          }
        } catch (e) {
          emailInput.value = '';
        }
      }
      
      const titleInput = document.getElementById('bug-title');
      if (titleInput) titleInput.focus();
    }
  }

  close() {
    if (this.overlay) {
      this.overlay.style.display = 'none';
      if (this.form) this.form.reset();
    }
  }
}

export const bugReport = new BugReportController();
