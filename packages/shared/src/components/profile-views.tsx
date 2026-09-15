import { Briefcase, Palette, Globe, Linkedin, FileText, Link2, Mail, Phone, MapPin } from 'lucide-react';
import { AgencyVerifiedBadge } from './agency-verified-badge';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { initialsOf } from '../lib/utils';
import { normalizeUrl } from '../lib/url';
import { useFileViewer } from './file-viewer/file-viewer-provider';

/* ──────────────────────────────────────────────────────────────────────────
 * Shared, dialog-agnostic profile views. Rendered standalone inside a
 * DialogContent (contractors / agencies pages) AND inline inside the task
 * detail dialog for a connection-request task. They render plain markup (no
 * Dialog wrapper) so they can be embedded anywhere.
 * ────────────────────────────────────────────────────────────────────────── */

interface ExperienceItem { role: string; company: string; duration: string; description: string }
interface PortfolioItem { title: string; description: string; projectUrl: string; imageUrl: string | null }

/** The full contractor record carried on connection rows / explore cards / tasks. */
export interface ContractorDetail {
  id: string;
  name: string | null;
  email: string | null;
  /** Profile picture from the contractor's linked user account. */
  profileUrl?: string | null;
  tagline: string | null;
  bio: string | null;
  skills: string[] | null;
  hourlyRate: string | null;
  isAvailable?: boolean;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  resumeUrl: string | null;
  resumeFileName?: string | null;
  portfolioItems?: unknown[] | null;
  experienceItems?: unknown[] | null;
}

/**
 * Complete contractor profile — the same fields surfaced on the Explore
 * Contractors card (avatar, tagline, rate, bio, skills, links) plus the full
 * work history and portfolio, so an agency can evaluate an application.
 */
export function ContractorProfileView({ c }: { c: ContractorDetail }) {
  const { openFile } = useFileViewer();
  const experiences = (c.experienceItems ?? []) as ExperienceItem[];
  const portfolio = (c.portfolioItems ?? []) as PortfolioItem[];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <Avatar className="h-14 w-14">{c.profileUrl && <AvatarImage src={c.profileUrl} />}<AvatarFallback>{initialsOf(c.name ?? c.email ?? '?')}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-ink-100">{c.name ?? '—'}</div>
          <div className="truncate text-sm text-ink-60">{c.tagline ?? 'Freelancer'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.hourlyRate != null && <Badge variant="muted">${Math.round(Number(c.hourlyRate))}/hr</Badge>}
            {c.isAvailable === false ? <Badge variant="muted">Unavailable</Badge> : c.isAvailable === true ? <Badge variant="success">Available</Badge> : null}
            {c.email && <span className="text-xs text-ink-40">{c.email}</span>}
          </div>
        </div>
      </div>

      {(c.websiteUrl || c.linkedinUrl || c.resumeUrl) && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-ink-60">
          {c.websiteUrl && <a href={normalizeUrl(c.websiteUrl)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-accent"><Globe className="h-4 w-4" /> Website</a>}
          {c.linkedinUrl && <a href={normalizeUrl(c.linkedinUrl)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-accent"><Linkedin className="h-4 w-4" /> LinkedIn</a>}
          {c.resumeUrl && <button type="button" onClick={() => openFile({ url: c.resumeUrl!, title: c.resumeFileName || 'Resume' })} className="flex items-center gap-1.5 hover:text-accent"><FileText className="h-4 w-4" /> {c.resumeFileName || 'Resume'}</button>}
        </div>
      )}

      {c.bio && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-ink-100">About</h3>
          <p className="whitespace-pre-line text-sm text-ink-80">{c.bio}</p>
        </section>
      )}

      {(c.skills ?? []).length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-100">Skills</h3>
          <div className="flex flex-wrap gap-1.5">{c.skills!.map((s) => <Badge key={s} variant="muted">{s}</Badge>)}</div>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-100"><Briefcase className="h-4 w-4" /> Work Experience</h3>
        {experiences.length === 0 ? (
          <p className="text-sm text-ink-40">No experience listed.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {experiences.map((exp, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-4">
                <div className="font-semibold text-ink-100">{exp.role}</div>
                <div className="text-sm font-medium text-ink-60">{[exp.company, exp.duration].filter(Boolean).join(' • ')}</div>
                {exp.description && <p className="mt-2 text-sm text-ink-80">{exp.description}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-100"><Palette className="h-4 w-4" /> Portfolio</h3>
        {portfolio.length === 0 ? (
          <p className="text-sm text-ink-40">No portfolio items.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {portfolio.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-4">
                {item.imageUrl && <button type="button" onClick={() => openFile({ url: item.imageUrl!, title: item.title || 'Image', fileType: 'image' })}><img src={item.imageUrl} alt="" className="h-[60px] w-20 rounded-md object-cover" /></button>}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink-100">{item.title}</div>
                  {item.projectUrl && <a href={normalizeUrl(item.projectUrl)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent underline"><Link2 className="h-3 w-3" /> {item.projectUrl}</a>}
                  {item.description && <p className="mt-1.5 text-sm text-ink-80">{item.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** The agency fields needed to render the agency info view. */
export interface AgencyDetail {
  businessName: string;
  logoUrl: string | null;
  platformVerified?: boolean | null;
  shortDescription: string | null;
  businessEmail: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  description: string | null;
  disciplines: string[] | null;
  social: { facebookUrl?: string; xUrl?: string; instagramUrl?: string } | null;
}

/**
 * Full agency profile — mirrors the agency info screen (identity, contact,
 * links, about, disciplines). No purchase stats (used for not-yet-connected
 * agencies, e.g. an incoming connection request).
 */
export function AgencyProfileView({ agency }: { agency: AgencyDetail }) {
  const social = agency.social ?? {};
  const links: Array<{ href: string; label: string; icon: typeof Globe }> = [];
  if (agency.website) links.push({ href: normalizeUrl(agency.website), label: 'Website', icon: Globe });
  if (social.facebookUrl) links.push({ href: normalizeUrl(social.facebookUrl), label: 'Facebook', icon: Link2 });
  if (social.xUrl) links.push({ href: normalizeUrl(social.xUrl), label: 'X', icon: Link2 });
  if (social.instagramUrl) links.push({ href: normalizeUrl(social.instagramUrl), label: 'Instagram', icon: Link2 });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12">{agency.logoUrl && <AvatarImage src={agency.logoUrl} />}<AvatarFallback>{initialsOf(agency.businessName)}</AvatarFallback></Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-semibold text-ink-100">
            {agency.businessName}
            <AgencyVerifiedBadge platformVerified={agency.platformVerified} />
          </div>
          {agency.shortDescription && <div className="text-sm text-ink-60">{agency.shortDescription}</div>}
        </div>
      </div>

      {(agency.businessEmail || agency.phone || agency.address) && (
        <section className="flex flex-col gap-1.5 text-sm text-ink-60">
          {agency.businessEmail && <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink-40" /> {agency.businessEmail}</span>}
          {agency.phone && <span className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-40" /> {agency.phone}</span>}
          {agency.address && <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-40" /> {agency.address}</span>}
        </section>
      )}

      {links.length > 0 && (
        <section className="flex flex-wrap items-center gap-4 text-sm text-ink-60">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-accent"><l.icon className="h-4 w-4" /> {l.label}</a>
          ))}
        </section>
      )}

      {agency.description && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-ink-100">About</h4>
          <p className="whitespace-pre-line text-sm text-ink-60">{agency.description}</p>
        </section>
      )}

      {(agency.disciplines ?? []).length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-100">Disciplines</h4>
          <div className="flex flex-wrap gap-2">{agency.disciplines!.map((d) => <Badge key={d} variant="muted">{d}</Badge>)}</div>
        </section>
      )}
    </div>
  );
}
