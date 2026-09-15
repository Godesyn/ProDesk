import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { Bolt, DollarSign, Link2, Trash2, Upload, Plus, Briefcase, Palette, FileText } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser } from '../../auth/auth-context';
import { INVITE_TOKEN_KEY } from '../../auth/use-invite-redemption';
import { uploadFile } from '../../lib/storage';
import { StorageBucket } from '../../lib/storage-buckets';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Field } from '../agency/form-bits';
import { OnboardingHeader } from '../../components/layout/onboarding-header';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';

const TEXTAREA_CLASS =
  'min-h-[96px] w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]';

interface ExperienceItem { role: string; company: string; duration: string; from: string | null; till: string | null; currentlyWorking: boolean; description: string }
interface PortfolioItem { title: string; description: string; projectUrl: string; imageUrl: string | null }

function normalizeUrl(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * Become a Contractor / Edit Contractor Profile — a 1:1 port of
 * create_contractor_screen.dart. Picked from role-selection (or reached later to
 * edit), it collects the professional profile and, on first creation, the server
 * (contractor.create) promotes the user to individualContractor — never
 * clobbering an existing role. After a fresh create we land on /contracts (Flutter
 * context.go('/contracts')); in edit mode we return to /contractor-dashboard.
 */
export function CreateContractorPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const uid = user?.id as string | undefined;
  const isEditMode = user?.role === 'individualContractor';

  const { data: existing } = useQuery({
    ...trpc.contractor.myProfile.queryOptions(),
    enabled: isEditMode,
  });

  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [rate, setRate] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [website, setWebsite] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [experiences, setExperiences] = useState<ExperienceItem[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [showExp, setShowExp] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Present when arriving from an in-app contractor-invite task (an existing user
  // who accepted an agency's invite but had no contractor profile yet). Captured
  // once; the agency connection is finalized server-side after the profile is built.
  const [connectAgencyId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('agencyId'));

  // Edit-mode prefill (Flutter _isInitialized one-shot hydration).
  useEffect(() => {
    if (!isEditMode || hydrated || !existing) return;
    setTagline(existing.tagline ?? '');
    setBio(existing.bio ?? '');
    setRate(existing.hourlyRate != null ? String(Math.round(Number(existing.hourlyRate))) : '');
    setWebsite(existing.websiteUrl ?? '');
    setLinkedin(existing.linkedinUrl ?? '');
    setResumeUrl(existing.resumeUrl ?? null);
    setResumeFileName(existing.resumeFileName ?? null);
    setSkills(existing.skills ?? []);
    setExperiences((existing.experienceItems as ExperienceItem[]) ?? []);
    setPortfolio((existing.portfolioItems as PortfolioItem[]) ?? []);
    setHydrated(true);
  }, [isEditMode, hydrated, existing]);

  const create = useMutation({
    ...trpc.contractor.create.mutationOptions(),
    onSuccess: async () => {
      // Consumed once the profile (and any agency connection) is created.
      localStorage.removeItem(INVITE_TOKEN_KEY);
      toast.success(isEditMode ? 'Contractor Profile Saved!' : 'Contractor Profile Created!');
      await Promise.all([
        qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
        qc.invalidateQueries({ queryKey: trpc.contractor.myProfile.queryKey() }),
      ]);
      navigate(isEditMode ? '/contractor-dashboard' : '/contracts');
    },
    onError: (e) => toastError(e),
  });

  const addSkill = (value: string) => {
    const s = value.trim();
    if (s && !skills.includes(s)) setSkills((prev) => [...prev, s]);
    setSkillInput('');
  };
  const onSkillKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(skillInput.replace(/,$/, '')); }
  };
  const onSkillChange = (v: string) => {
    if (v.includes(',')) { v.split(',').forEach((s) => s.trim() && addSkill(s)); }
    else setSkillInput(v);
  };

  async function pickResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uid) return;
    setUploadingResume(true);
    try {
      const url = await uploadFile(StorageBucket.Uploads, `contractors/${uid}/resume`, file, { noCompress: true });
      setResumeUrl(url);
      setResumeFileName(file.name);
      toast.success('Resume uploaded successfully!');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploadingResume(false);
    }
  }

  const submit = () => {
    setError(null);
    if (!tagline.trim()) { setError('Professional Tagline is required'); return; }
    if (!bio.trim()) { setError('Professional Bio is required'); return; }
    if (!rate.trim() || Number.isNaN(Number(rate))) { setError('A valid Hourly Rate is required'); return; }
    if (skills.length === 0) { toast.warning('Please add at least one skill'); return; }
    create.mutate({
      tagline: tagline.trim(),
      bio: bio.trim(),
      hourlyRate: Number(rate),
      skills,
      // Normalize to an absolute URL (prepend https://) so links are clickable —
      // matches AppValidator.normalizeUrl in create_contractor_screen.dart.
      websiteUrl: normalizeUrl(website) || undefined,
      linkedinUrl: normalizeUrl(linkedin) || undefined,
      resumeUrl: resumeUrl || undefined,
      resumeFileName: resumeFileName || undefined,
      portfolioItems: portfolio,
      experienceItems: experiences,
      // Present when arriving from a contractor-invite link — connects to the
      // inviting agency once the profile is created (server verifies the token).
      inviteToken: isEditMode ? undefined : localStorage.getItem(INVITE_TOKEN_KEY) || undefined,
      // Present when arriving from an in-app contractor-invite task — finalizes the
      // pendingInvite connection to that agency once the profile exists.
      connectAgencyId: isEditMode ? undefined : connectAgencyId || undefined,
    });
  };

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-10 animate-reveal">
      <OnboardingHeader
        eyebrow="Contractor profile"
        title={isEditMode ? 'Update your professional' : 'Set up your professional'}
        titleAccent="profile"
        description={isEditMode
          ? 'Keep your portfolio, CV, and work history up to date for agencies.'
          : 'Present your work, experience, and links to agencies seeking talent.'}
        backTo={isEditMode ? undefined : '/role-selection'}
        backLabel="Choose a different role"
      />


      <div className="grid gap-6 lg:grid-cols-11">
        <div className="flex flex-col gap-6 lg:col-span-5">
          {/* Professional Details */}
          <Card className="p-6">
            <h2 className="text-h4 text-ink-100">Professional Details</h2>
            <div className="mt-5 flex flex-col gap-4">
              <Field label="Professional Tagline">
                <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Senior Mobile Engineer & UI Designer" />
              </Field>
              <Field label="Professional Bio">
                <textarea className={TEXTAREA_CLASS} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Introduce yourself, your background, and your strengths..." />
              </Field>
              <Field label="Hourly Rate ($)">
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
                  <Input className="pl-9" type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
              </Field>
              <Field label="Add Skills" hint="Press Enter or Comma to add skills">
                <div className="relative">
                  <Bolt className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
                  <Input className="pl-9" value={skillInput} onChange={(e) => onSkillChange(e.target.value)} onKeyDown={onSkillKey} placeholder="Type skill and press Enter or Comma" />
                </div>
              </Field>
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <Badge key={s} variant="accent" className="gap-1">
                      {s}
                      <button type="button" onClick={() => setSkills((prev) => prev.filter((x) => x !== s))} className="ml-0.5 text-current/70 hover:text-current">×</button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Resume & Links */}
          <Card className="p-6">
            <h2 className="text-h4 text-ink-100">Resume &amp; Links</h2>
            <div className="mt-5 flex flex-col gap-4">
              <div className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-4">
                <div className="text-sm font-semibold text-ink-100">Resume / CV Document</div>
                <div className="mt-2">
                  {!resumeUrl ? (
                    <>
                      <input id="resume" type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={pickResume} />
                      <Button type="button" variant="outline" disabled={uploadingResume} onClick={() => document.getElementById('resume')?.click()}>
                        <Upload className="h-4 w-4" /> {uploadingResume ? 'Uploading…' : 'Upload Resume (PDF, DOC)'}
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-accent" />
                      <a href={resumeUrl} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm font-medium text-accent underline">
                        {resumeFileName ?? 'Resume.pdf'}
                      </a>
                      <button type="button" onClick={() => { setResumeUrl(null); setResumeFileName(null); }} className="text-danger">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Field label="Portfolio Website">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
                  <Input className="pl-9" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://mywebsite.com" />
                </div>
              </Field>
              <Field label="LinkedIn Profile">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
                  <Input className="pl-9" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/username" />
                </div>
              </Field>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-6">
          {/* Work Experience */}
          <Card className="p-6">
            <h2 className="text-h4 text-ink-100">Work Experience</h2>
            <div className="mt-5 flex flex-col gap-3">
              {experiences.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-ink-40">
                  <Briefcase className="h-9 w-9" />
                  <span className="text-sm text-ink-60">No experience added yet.</span>
                </div>
              ) : (
                experiences.map((exp, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-4">
                    <div className="flex-1">
                      <div className="font-semibold text-ink-100">{exp.role}</div>
                      <div className="text-sm font-medium text-ink-60">{exp.company} • {exp.duration}</div>
                      {exp.description && <p className="mt-2 text-sm text-ink-80">{exp.description}</p>}
                    </div>
                    <button type="button" onClick={() => setExperiences((p) => p.filter((_, idx) => idx !== i))} className="text-ink-40 hover:text-danger">×</button>
                  </div>
                ))
              )}
              <Button type="button" variant="outline" onClick={() => setShowExp(true)}><Plus className="h-4 w-4" /> Add Experience</Button>
            </div>
          </Card>

          {/* Portfolio Projects */}
          <Card className="p-6">
            <h2 className="text-h4 text-ink-100">Portfolio Projects</h2>
            <div className="mt-5 flex flex-col gap-3">
              {portfolio.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-ink-40">
                  <Palette className="h-9 w-9" />
                  <span className="text-sm text-ink-60">No portfolio items added yet.</span>
                </div>
              ) : (
                portfolio.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-4">
                    {item.imageUrl && <img src={item.imageUrl} alt="" className="h-[60px] w-20 rounded-md object-cover" />}
                    <div className="flex-1">
                      <div className="font-semibold text-ink-100">{item.title}</div>
                      {item.projectUrl && <a href={normalizeUrl(item.projectUrl)} target="_blank" rel="noreferrer" className="text-xs text-accent underline">{item.projectUrl}</a>}
                      {item.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-80">{item.description}</p>}
                    </div>
                    <button type="button" onClick={() => setPortfolio((p) => p.filter((_, idx) => idx !== i))} className="text-ink-40 hover:text-danger">×</button>
                  </div>
                ))
              )}
              <Button type="button" variant="outline" onClick={() => setShowPortfolio(true)}><Plus className="h-4 w-4" /> Add Portfolio Project</Button>
            </div>
          </Card>
        </div>
      </div>

      {error && <p className="mt-6 text-center text-sm text-danger">{error}</p>}
      <Button variant="accent" size="lg" className="mt-8 w-full" disabled={create.isPending} onClick={submit}>
        {create.isPending ? 'Saving…' : isEditMode ? 'Save Profile Changes' : 'Complete Freelancer Profile'}
      </Button>

      {showExp && <AddExperienceDialog onClose={() => setShowExp(false)} onSave={(exp) => { setExperiences((p) => [...p, exp]); setShowExp(false); }} />}
      {showPortfolio && uid && <AddPortfolioDialog uid={uid} onClose={() => setShowPortfolio(false)} onSave={(item) => { setPortfolio((p) => [...p, item]); setShowPortfolio(false); }} />}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2024-03-15" / "2024-03" → "Mar 2024" (work history is shown at month granularity). */
function fmtMonth(v: string): string {
  const [y, m] = v.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

/** Today as an `YYYY-MM-DD` string, for the date inputs' `max` (no future dates). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddExperienceDialog({ onClose, onSave }: { onClose: () => void; onSave: (e: ExperienceItem) => void }) {
  const today = todayISO();
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [from, setFrom] = useState('');
  const [till, setTill] = useState('');
  const [current, setCurrent] = useState(false);
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Keep `till` consistent with `from`: clear it if it's no longer strictly after.
  function onFromChange(v: string) {
    setFrom(v);
    if (till && v && till <= v) setTill('');
  }

  const save = () => {
    if (!role.trim() || !company.trim()) { setErr('Role and Company are required'); return; }
    if (!from) { setErr('Please select a start date'); return; }
    if (from > today) { setErr('Start date cannot be in the future'); return; }
    if (!current) {
      if (!till) { setErr('Please select an end date (or tick “Still working here”)'); return; }
      if (till > today) { setErr('End date cannot be in the future'); return; }
      if (till <= from) { setErr('End date must be after the start date'); return; }
    }
    const duration = `${fmtMonth(from)} - ${current ? 'Present' : fmtMonth(till)}`;
    onSave({ role: role.trim(), company: company.trim(), duration, from, till: current ? null : till, currentlyWorking: current, description: description.trim() });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Experience</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Role / Title"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Lead Designer" /></Field>
          <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Corp" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Input type="date" max={today} value={from} onChange={(e) => onFromChange(e.target.value)} /></Field>
            {!current && <Field label="Till"><Input type="date" min={from || undefined} max={today} value={till} onChange={(e) => setTill(e.target.value)} /></Field>}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-80">
            <input type="checkbox" checked={current} onChange={(e) => { setCurrent(e.target.checked); if (e.target.checked) setTill(''); }} />
            Still working here
          </label>
          <Field label="Role Description"><textarea className={TEXTAREA_CLASS} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you do at this job?" /></Field>
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPortfolioDialog({ uid, onClose, onSave }: { uid: string; onClose: () => void; onSave: (p: PortfolioItem) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectUrl, setProjectUrl] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(StorageBucket.Uploads, `contractors/${uid}/portfolio`, file);
      setImageUrl(url);
      toast.success('Project screenshot uploaded!');
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const save = () => {
    if (!title.trim()) { setErr('Project Title is required'); return; }
    onSave({ title: title.trim(), description: description.trim(), projectUrl: projectUrl.trim(), imageUrl });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Portfolio Project</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Project Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prodesk App Redesign" /></Field>
          <Field label="Project Description"><textarea className={TEXTAREA_CLASS} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain what this project is and what you built..." /></Field>
          <Field label="Project URL (optional)"><Input value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://myproject.com" /></Field>
          <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-3">
            {imageUrl && <img src={imageUrl} alt="" className="h-[60px] w-20 rounded-md object-cover" />}
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-100">Project Screenshot</div>
              <div className="text-xs text-ink-60">{imageUrl ? 'Screenshot uploaded successfully' : 'Upload a preview image of your project'}</div>
            </div>
            {!imageUrl ? (
              <>
                <input id="pf-img" type="file" accept="image/*" className="hidden" onChange={pickImage} />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => document.getElementById('pf-img')?.click()}>
                  <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload'}
                </Button>
              </>
            ) : (
              <button type="button" onClick={() => setImageUrl(null)} className="text-danger"><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
