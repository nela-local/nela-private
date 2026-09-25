import "./ToolActivityTimeline.css";

export type ToolActivityStep = {
  id: string;
  label: string;
  /** Still running when true. */
  active: boolean;
};

type Props = {
  steps: ToolActivityStep[];
};

/**
 * Live tool status: only the current step (completed history is omitted to save space).
 */
export default function ToolActivityTimeline({ steps }: Props) {
  if (!steps.length) return null;
  const current =
    [...steps].reverse().find((s) => s.active) ?? steps[steps.length - 1];
  if (!current) return null;

  return (
    <ul className="tool-activity" aria-label="Tool activity" aria-live="polite">
      <li
        key={current.id}
        className={`tool-activity__step${
          current.active ? " tool-activity__step--active" : ""
        }`}
      >
        <span
          className={`tool-activity__dot${
            current.active ? " tool-activity__dot--pulse" : ""
          }`}
          aria-hidden
        />
        <span className="tool-activity__label">{current.label}</span>
      </li>
    </ul>
  );
}
