import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { TEMPLATES } from '@/templates/registry';
import { fontStack, ensureFont } from '@/lib/fonts/registry';
import { A4_W } from '@/lib/paperSize';
import type { Theme } from '@/schema/resume';

/**
 * Miniature of a template, rendered with the real paper class names, the real
 * template stylesheets AND the real layout-axis attributes, so the thumbnail shows
 * the structure clicking it gives you - not just its colours. Only the top of the
 * page is shown; that is where the presets differ most.
 *
 * The markup below mirrors EditorPaper's element nesting exactly (.cv-head wrapper,
 * .cv-etop's inner div, .cv-entry inside .cv-section, .cv-skillrow + .cv-chips).
 * That nesting is load-bearing: the axis rules in paper.css are written against it,
 * so a flattened preview would silently ignore headerLayout and entryLayout. It is
 * a hand-written miniature rather than a live <EditorPaper> because mounting one
 * interactive paper per template would put seven ResizeObservers and seven framer
 * Reorder groups in the sidebar; if EditorPaper's DOM changes, this must follow.
 *
 * The template's own typographic defaults are applied as local --paper-* overrides,
 * but the accent is deliberately inherited from :root so previews appear in the
 * colour the user actually picked.
 */
export const TemplatePreview = memo(function TemplatePreview({
  id,
  skillStyle = 'plain',
}: {
  id: string;
  skillStyle?: Theme['skillStyle'];
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Scale from the card's real width: a fixed factor would crop the page sideways
  // and cut the centred templates' names in half.
  const [scale, setScale] = useState(0.18);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / A4_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = TEMPLATES[id];
  useEffect(() => {
    if (t) ensureFont(t.defaultTheme.fontFamily);
  }, [t]);
  if (!t) return null;
  const d = t.defaultTheme;

  return (
    <div className="tpl-thumb" ref={ref} aria-hidden="true">
      <div
        className="print-paper tpl-thumb-page"
        data-template={id}
        data-dividers={String(d.dividers)}
        data-skills={skillStyle}
        data-header={d.headerLayout}
        data-entry={d.entryLayout}
        data-heading={d.headingLayout}
        style={
          {
            '--paper-font': fontStack(d.fontFamily),
            '--paper-size': `${d.basePt}pt`,
            '--paper-lh': String(d.lineHeight),
            '--paper-hscale': String(d.headingScale),
            '--paper-nscale': String(d.nameScale),
            '--paper-rscale': String(d.roleScale),
            '--paper-tscale': String(d.titleScale),
            '--paper-block': String(d.blockSpacing),
            '--paper-row': String(d.rowSpacing),
            '--paper-margin': `${d.marginPt}pt`,
            transform: `scale(${scale})`,
            fontFamily: 'var(--paper-font)',
            fontSize: 'var(--paper-size)',
            lineHeight: 'var(--paper-lh)',
            padding: 'var(--paper-margin)',
          } as CSSProperties
        }
      >
        <div className="cv-head">
          <div className="cv-h1">Alex Morgan</div>
          <div className="cv-title">Senior Engineer</div>
          <div className="cv-contact">
            <span className="cv-contact-item">alex@mail.com</span>
            <span className="cv-contact-item">London</span>
          </div>
        </div>
        <div className="cv-rule" />
        <div className="cv-section">
          <div className="cv-secH">Experience</div>
          <div className="cv-entry">
            <div className="cv-etop">
              <div>
                <span className="cv-role">Backend Engineer</span> <span className="cv-co">Northwind</span>
              </div>
              <div className="cv-date">2022 - Present</div>
            </div>
            <ul className="cv-ul">
              <li className="cv-li">Cut checkout latency by 40 percent.</li>
              <li className="cv-li">Shipped a public API used by partners.</li>
            </ul>
          </div>
        </div>
        <div className="cv-section">
          <div className="cv-secH">Skills</div>
          <div className="cv-skillrow">
            <span className="cv-skilllabel">Languages</span>
            <div className="cv-chips">
              <span className="cv-chip">Go</span>
              <span className="cv-chip">AWS</span>
              <span className="cv-chip">SQL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
