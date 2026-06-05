import { useState, type CSSProperties } from "react";
import { avatarTint, avatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export function RoleAvatar({
  seed,
  name,
  color,
  className,
  style,
  title,
}: {
  seed: string;
  name?: string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const tint = avatarTint(color);
  const initial = (name || seed || "?").trim().charAt(0);

  return (
    <span
      title={title}
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full border", className)}
      style={{ background: tint.background, borderColor: tint.borderColor, ...style }}
    >
      {failed ? (
        <span className="text-sm font-bold text-foreground/70">{initial}</span>
      ) : (
        <img
          src={avatarUrl(seed)}
          alt={name || seed}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
