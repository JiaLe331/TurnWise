import { ChevronDown } from 'lucide-react'
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from '@/components/ui/dropdown'
import { ROLE_LABEL } from '@/lib/domain/permissions'
import { useIdentity } from '@/lib/identity/dev-identity'
import { PERSONAS } from '@/lib/identity/personas'

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-[26px] place-items-center rounded-[7px] bg-cleaning-tint text-[11.5px] font-bold text-cleaning-deep">
      {initials}
    </span>
  )
}

/** Local-development identity picker. Not rendered in production builds. */
export function PersonaSwitcher({ compact = false }: { compact?: boolean }) {
  const { actor, setActorId } = useIdentity()
  if (!import.meta.env.DEV || !actor) return null

  return (
    <Dropdown>
      <DropdownTrigger
        className="inline-flex items-center gap-2 rounded-[10px] border border-rule bg-white py-1 pr-2.5 pl-1 text-[14px] font-semibold hover:bg-wash"
        aria-label={`Acting as ${actor.id}, ${ROLE_LABEL[actor.role]}. Change development identity`}
      >
        <Avatar initials={actor.initials} />
        {compact ? null : (
          <>
            {actor.id}
            <span className="rounded-[5px] bg-demo-tint px-1.5 py-0.5 text-[11px] font-semibold text-demo">
              Dev identity
            </span>
          </>
        )}
        <ChevronDown className="size-4 text-pewter" aria-hidden />
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel className="px-2.5 pt-1.5 pb-2 text-[12.5px] font-medium text-pewter">
          Act as (local development only)
        </DropdownLabel>
        <DropdownRadioGroup value={actor.id} onValueChange={setActorId}>
          {PERSONAS.map((p) => (
            <DropdownRadioItem key={p.id} value={p.id}>
              <Avatar initials={p.initials} />
              <span className="flex-1">{p.id}</span>
              <span className="text-[12.5px] font-medium text-pewter">{ROLE_LABEL[p.role]}</span>
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  )
}
