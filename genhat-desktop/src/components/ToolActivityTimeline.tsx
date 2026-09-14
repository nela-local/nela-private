import "./ToolActivityTimeline.css";

export type ToolActivityStep = {
  id: string;
  label: string;
  /** Still running when true; completed steps stay in the list. */
  active: boolean;
};

type Props = {
  steps: ToolActivityStep[];
};

/**
 * Cursor-style progressive tool updates under reasoning:
 * completed steps stay visible; the active one pulses.
 */
export default function ToolActivityTimeline({ steps }: Props) {
  if (!steps.length) return null;

  return (
    <ul className="tool-activity" aria-label="Tool activity">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`tool-activity__step${
            step.active ? " tool-activity__step--active" : ""
          }`}
        >
          <span
            className={`tool-activity__dot${
              step.active ? " tool-activity__dot--pulse" : ""
            }`}
            aria-hidden
          />
          <span className="tool-activity__label">{step.label}</span>
        </li>
      ))}
    </ul>
  );
}
