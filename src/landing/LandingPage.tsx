import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Menu,
  Mic,
  Package,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { CursorReactiveBackdrop } from '../motion/CursorReactiveBackdrop';
import { FadeIn, Pressable, Stagger } from '../motion/Motion';

export type LandingAction =
  | 'home'
  | 'how'
  | 'features'
  | 'roles'
  | 'apply'
  | 'signin_menu'
  | 'shopkeeper_signin'
  | 'shopkeeper_signup'
  | 'wholesaler_signin'
  | 'delivery_signin'
  | 'admin_signin';

type Props = {
  onAction: (action: LandingAction) => void;
  applyOpen: boolean;
  onCloseApply: () => void;
  onSubmitApply: (form: ApplyForm) => Promise<void>;
  applyBusy: boolean;
  applyError: string;
  applySuccess: string;
};

export type ApplyForm = {
  businessName: string;
  applicantName: string;
  email: string;
  phone: string;
  location: string;
  description: string;
  category: string;
};

function TiltCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (reduced.current) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (0.5 - py) * 8;
    const ry = (px - 0.5) * 10;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
  };

  const onLeave = () => {
    if (ref.current) ref.current.style.transform = '';
  };

  return (
    <div
      ref={ref}
      className={`role-tilt-card ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </div>
  );
}

export function LandingPage({
  onAction,
  applyOpen,
  onCloseApply,
  onSubmitApply,
  applyBusy,
  applyError,
  applySuccess,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [form, setForm] = useState<ApplyForm>({
    businessName: '',
    applicantName: '',
    email: '',
    phone: '',
    location: 'Peshawar',
    description: '',
    category: 'General Wholesale',
  });

  useEffect(() => {
    const ids = ['home', 'how', 'features', 'roles'];
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-35% 0px -45% 0px', threshold: [0.15, 0.4] }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    setSignInOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const navLink = (id: string, label: string) => (
    <button
      type="button"
      className={`site-nav-link ${activeSection === id ? 'is-active' : ''}`}
      onClick={() => scrollTo(id)}
    >
      {label}
    </button>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmitApply(form);
  };

  const roles = [
    {
      key: 'shop',
      title: 'Shopkeeper',
      blurb: 'Discover products, order stock, and track deliveries.',
      icon: ShoppingCart,
      actionLabel: 'Start Ordering',
      action: () => onAction('shopkeeper_signin'),
      tone: 'shop',
    },
    {
      key: 'wh',
      title: 'Wholesaler',
      blurb: 'Manage your catalog, fulfill orders, and grow your business.',
      icon: Package,
      actionLabel: 'Become a Wholesaler',
      action: () => onAction('apply'),
      tone: 'wh',
    },
    {
      key: 'dl',
      title: 'Delivery Personnel',
      blurb: 'Manage assignments and update delivery progress.',
      icon: Truck,
      actionLabel: 'Delivery Sign In',
      action: () => onAction('delivery_signin'),
      tone: 'dl',
    },
    {
      key: 'ad',
      title: 'Administrator',
      blurb: 'Oversee platform operations and approvals.',
      icon: ShieldCheck,
      actionLabel: 'Admin Sign In',
      action: () => onAction('admin_signin'),
      tone: 'ad',
    },
  ] as const;

  return (
    <div className="site-shell">
      <header className="site-nav">
        <div className="site-nav-inner">
          <button type="button" className="site-brand" onClick={() => scrollTo('home')} aria-label="Home">
            <span className="site-brand-mark">
              <Store className="w-5 h-5" />
            </span>
            <span className="site-brand-text">
              <strong>Peshawar Wholesale</strong>
              <span>General Store &amp; Drinks</span>
            </span>
          </button>

          <nav className="site-nav-links" aria-label="Primary">
            {navLink('home', 'Home')}
            {navLink('how', 'How It Works')}
            {navLink('features', 'Features')}
            <button type="button" className="site-nav-link" onClick={() => onAction('apply')}>
              Become a Wholesaler
            </button>
          </nav>

          <div className="site-nav-actions">
            <div className="relative">
              <button
                type="button"
                className="btn btn-ghost btn-sm !border-line"
                onClick={() => setSignInOpen((v) => !v)}
                aria-expanded={signInOpen}
              >
                Sign In
              </button>
              {signInOpen && (
                <div className="site-signin-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setSignInOpen(false); onAction('shopkeeper_signin'); }}>Shopkeeper</button>
                  <button type="button" role="menuitem" onClick={() => { setSignInOpen(false); onAction('wholesaler_signin'); }}>Wholesaler</button>
                  <button type="button" role="menuitem" onClick={() => { setSignInOpen(false); onAction('delivery_signin'); }}>Delivery</button>
                  <button type="button" role="menuitem" onClick={() => { setSignInOpen(false); onAction('admin_signin'); }}>Administrator</button>
                </div>
              )}
            </div>
            <Pressable className="btn btn-primary btn-sm hidden sm:inline-flex" onClick={() => onAction('shopkeeper_signup')}>
              Get Started
            </Pressable>
            <button
              type="button"
              className="site-menu-toggle sm:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="site-mobile-menu">
            <button type="button" onClick={() => scrollTo('home')}>Home</button>
            <button type="button" onClick={() => scrollTo('how')}>How It Works</button>
            <button type="button" onClick={() => scrollTo('features')}>Features</button>
            <button type="button" onClick={() => { setMenuOpen(false); onAction('apply'); }}>Become a Wholesaler</button>
            <button type="button" onClick={() => { setMenuOpen(false); onAction('shopkeeper_signin'); }}>Sign In</button>
            <button type="button" className="btn btn-primary w-full" onClick={() => { setMenuOpen(false); onAction('shopkeeper_signup'); }}>Get Started</button>
          </div>
        )}
      </header>

      <section id="home" className="site-hero">
        <CursorReactiveBackdrop />
        <div className="site-hero-content">
          <FadeIn>
            <p className="site-eyebrow">AI-assisted wholesale ordering &amp; operations</p>
          </FadeIn>
          <FadeIn delay={0.06}>
            <h1 className="site-hero-title">Wholesale Ordering, Simplified.</h1>
          </FadeIn>
          <FadeIn delay={0.12}>
            <p className="site-hero-lead">
              One intelligent platform connecting shopkeepers, wholesalers, and delivery teams—making ordering,
              inventory management, and fulfillment faster and easier.
            </p>
          </FadeIn>
          <FadeIn delay={0.18} className="site-hero-ctas">
            <Pressable className="btn btn-accent btn-lg" onClick={() => onAction('shopkeeper_signin')}>
              Start Ordering <ArrowRight className="w-4 h-4" />
            </Pressable>
            <Pressable className="btn btn-ghost btn-lg !border-white/35 !text-white hover:!bg-white/10" onClick={() => onAction('apply')}>
              Become a Wholesaler
            </Pressable>
          </FadeIn>
        </div>
      </section>

      <section id="roles" className="site-section">
        <div className="site-section-inner">
          <FadeIn>
            <p className="section-kicker">Who it is for</p>
            <h2 className="section-title">Four roles. One connected workflow.</h2>
            <p className="section-lead">Choose your portal. Each role has the tools it needs—securely separated.</p>
          </FadeIn>
          <Stagger className="role-grid" stagger={0.08}>
            {roles.map((role) => {
              const Icon = role.icon;
              return (
                <TiltCard key={role.key} className={`tone-${role.tone}`}>
                  <div className="role-icon">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3>{role.title}</h3>
                  <p>{role.blurb}</p>
                  <Pressable className="btn btn-secondary btn-sm mt-auto" onClick={role.action}>
                    {role.actionLabel}
                  </Pressable>
                </TiltCard>
              );
            })}
          </Stagger>
        </div>
      </section>

      <section id="how" className="site-section site-section-alt">
        <div className="site-section-inner">
          <FadeIn>
            <p className="section-kicker">How it works</p>
            <h2 className="section-title">From request to delivery in clear steps.</h2>
          </FadeIn>
          <ol className="how-steps">
            {[
              { t: 'Browse or ask AI', d: 'Shopkeepers search the catalog or order in English, Urdu, or Pashto—including voice.' },
              { t: 'Confirm the order', d: 'Review the cart and place the order explicitly. Nothing checks out automatically.' },
              { t: 'Wholesaler approval', d: 'Tenants approve or reject against live stock, then reserve inventory.' },
              { t: 'Deliver & settle', d: 'Delivery updates the run; invoices and payments close the loop.' },
            ].map((step, i) => (
              <li key={step.t}>
                <span className="how-num">{i + 1}</span>
                <div>
                  <strong>{step.t}</strong>
                  <p>{step.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="site-section">
        <div className="site-section-inner">
          <FadeIn>
            <p className="section-kicker">What it does</p>
            <h2 className="section-title">Built for real wholesale operations.</h2>
          </FadeIn>
          <div className="feature-grid">
            {[
              { icon: Mic, t: 'Multilingual AI ordering', d: 'Draft carts from live inventory in English, Urdu, and Pashto—with honest fallbacks when AI is unavailable.' },
              { icon: ClipboardList, t: 'Catalog, cart & checkout', d: 'MOQ checks, multi-wholesaler splits, and secure order confirmation.' },
              { icon: Package, t: 'Inventory & fulfillment', d: 'Approve, reserve, dispatch, and track deliveries end to end.' },
              { icon: CheckCircle2, t: 'Invoices, payments & alerts', d: 'Ledger-ready invoices, payment recording, and email notifications.' },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <article key={f.t} className="feature-card">
                  <div className="feature-icon">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3>{f.t}</h3>
                  <p>{f.d}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-section-inner site-footer-inner">
          <div>
            <strong>Peshawar General Store &amp; Drinks Wholesale</strong>
            <p>Professional AI-assisted wholesale ordering for Peshawar businesses.</p>
          </div>
          <div className="site-footer-links">
            <button type="button" onClick={() => onAction('apply')}>Become a Wholesaler</button>
            <button type="button" onClick={() => onAction('shopkeeper_signin')}>Shopkeeper Sign In</button>
            <button type="button" onClick={() => onAction('wholesaler_signin')}>Wholesaler Sign In</button>
          </div>
        </div>
        <p className="site-footer-copy">© 2026 Peshawar Wholesale · Secure multi-role commerce</p>
      </footer>

      {applyOpen && (
        <div className="apply-overlay" role="dialog" aria-modal="true" aria-labelledby="apply-title">
          <div className="apply-modal">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="apply-title" className="font-serif font-bold text-xl text-brand">Become a Wholesaler</h2>
                <p className="text-sm text-muted mt-1">Submit your business details. An administrator will review your application before any account is activated.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={onCloseApply} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {applySuccess ? (
              <div className="alert alert-success text-sm space-y-3">
                <p>{applySuccess}</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={onCloseApply}>Close</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {applyError && <div className="alert alert-danger text-xs">{applyError}</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Business name</label>
                    <input required className="field" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">Applicant name</label>
                    <input required className="field" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">Email</label>
                    <input required type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">Phone</label>
                    <input required className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XXXXXXXXX" />
                  </div>
                  <div>
                    <label className="field-label">Business location</label>
                    <input required className="field" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">Category</label>
                    <input className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="field-label">Business description</label>
                  <textarea
                    required
                    rows={4}
                    className="field !min-h-[6rem]"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Tell us what you wholesale, your coverage area, and typical order volume."
                  />
                </div>
                <div className="flex flex-wrap gap-2 justify-end pt-1">
                  <button type="button" className="btn btn-ghost" onClick={onCloseApply}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={applyBusy}>
                    {applyBusy ? 'Submitting…' : 'Submit application'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
