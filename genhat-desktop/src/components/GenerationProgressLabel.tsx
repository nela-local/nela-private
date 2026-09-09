import NelaLoadingIcon from "./NelaLoadingIcon";

interface GenerationProgressLabelProps {
  active: boolean;
  className?: string;
}

export default function GenerationProgressLabel({
  active,
  className = "",
}: GenerationProgressLabelProps) {
  if (!active) return null;

  return (
    <div className={`flex items-center ${className}`}>
      <NelaLoadingIcon />
    </div>
  );
}
