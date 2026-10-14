/**
 * Contact us, drawn by React.
 *
 * Converted one-to-one from renderContactUs() (…/js/01-app/59-storefront-public-vendor-page.js:526): same
 * markup, same classes, same contact details and links. The contact details are our own static data (they are
 * kept here in one place, exactly as in the legacy function); nothing comes from the database.
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity
 * test (tests/e2e/pilot-contact-us.spec.ts) fails if they drift apart.
 *
 * Behaviour kept from the legacy page:
 *  - each social button calls the app's global window.trackSocialClick(key) and opens the profile in a new tab;
 *  - "Send a request" calls the app's own navigate("supportRequest").
 * Icons are Font Awesome classes, exactly as before.
 */
declare global {
  interface Window {
    trackSocialClick?: (key: string) => void;
  }
}

const CHANNELS = [
  { icon: "fa-envelope", label: "Email", value: "Levromartsupport@gmail.com", href: "mailto:Levromartsupport@gmail.com" },
  { icon: "fa-phone", label: "Phone", value: "+234 806 322 7669", href: "tel:+2348063227669" },
  { icon: "fa-phone", label: "Phone", value: "+234 806 063 8179", href: "tel:+2348060638179" },
] as const;

const SOCIALS = [
  { logo: "/social-instagram.jpg", label: "Instagram", key: "instagram", href: "https://instagram.com/levromart" },
  { logo: "/social-tiktok.jpg", label: "TikTok", key: "tiktok", href: "https://tiktok.com/@levromart" },
  { logo: "/social-linkedin.png", label: "LinkedIn", key: "linkedin", href: "https://linkedin.com/company/levromart" },
] as const;

export default function ContactUsPage() {
  return (
    <div className="contact-us-page">
      <h2>
        <i className="fa-solid fa-address-book"></i> Contact us
      </h2>
      <p className="muted contact-us-sub">We're happy to help. Reach us directly or find us on social media.</p>
      <div className="card contact-us-card">
        {CHANNELS.map((c) => (
          <a key={c.href} className="contact-us-row" href={c.href}>
            <span className="contact-us-row-icon">
              <i className={`fa-solid ${c.icon}`}></i>
            </span>
            <span className="contact-us-row-copy">
              <span className="contact-us-row-label">{c.label}</span>
              <strong>{c.value}</strong>
            </span>
            <i className="fa-solid fa-chevron-right contact-us-row-arrow"></i>
          </a>
        ))}
      </div>
      <h3 className="contact-us-socials-title">Follow us</h3>
      <div className="contact-us-socials">
        {SOCIALS.map((s) => (
          <a
            key={s.key}
            className="contact-us-social-btn"
            href={s.href}
            target="_blank"
            rel="noopener"
            onClick={() => window.trackSocialClick?.(s.key)}
          >
            <img src={s.logo} alt={s.label} className="contact-us-social-logo" loading="lazy" decoding="async" />
            <span>{s.label}</span>
          </a>
        ))}
      </div>
      <p className="muted contact-us-handle">@levromart on all platforms</p>
      <p className="muted contact-us-handle" style={{ marginTop: ".2rem" }}>
        Followed us? Screenshot it and send it on{" "}
        <a href="https://wa.me/2348063227669" target="_blank" rel="noopener noreferrer">
          WhatsApp to 0806 322 7669
        </a>{" "}
        to earn leaderboard points.
      </p>
      <div className="contact-us-help">
        <span className="contact-us-help-ico">
          <i className="fa-solid fa-headset"></i>
        </span>
        <div>
          <strong>Need help with an order or your account?</strong>
          <p>Send us a support request and our team will reply inside the app.</p>
        </div>
        <button type="button" className="vl-add" onClick={() => window.navigate?.("supportRequest")}>
          <i className="fa-solid fa-paper-plane"></i> Send a request
        </button>
      </div>
      <p className="contact-us-tag">BUY • SELL • CONNECT</p>
    </div>
  );
}
