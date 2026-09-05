"use client";

import {
  Activity,
  ArrowRight,
  CalendarClock,
  Gift,
  KeyRound,
  LockKeyhole,
  Network,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import type { Address } from "viem";

import { VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT } from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-app.module.css";
import {
  AddressText,
  ExplorerLink,
  HumanActionBadge,
  InlineNotice,
  MeridianButton,
  MeridianPrivateValue,
  ProtocolBadge,
  Surface,
} from "@/components/meridian";
import { meridianNavigationItem, type MeridianView } from "@/components/meridian/app-navigation";
import { MeridianSaveControl } from "@/components/meridian/save-control";
import { ThemeControl } from "@/components/theme-control";

interface MeridianWorkspaceProps {
  readonly authenticatedAddress: Address;
  readonly view: MeridianView;
  readonly privacyShield: boolean;
  readonly onNavigate: (view: MeridianView) => void;
  readonly onOpenWallet: () => void;
  readonly onTogglePrivacy: () => void;
}

interface GuardedFeatureProps {
  readonly icon: typeof WalletCards;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly nextGate: string;
}

const DEPLOYMENT_ROWS = [
  ["Pool V2", VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool],
  ["VeilDraw Engine V2", VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine],
  ["Autopilot Vault", VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault],
  ["Yield Adapter V2", VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter],
  ["Prize Reserve", VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve],
] as const;

function compactAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function GuardedFeature({
  icon: Icon,
  eyebrow,
  title,
  description,
  nextGate,
}: GuardedFeatureProps) {
  return (
    <Surface className={styles.guardedFeature} elevation="raised">
      <div className={styles.guardedIcon}>
        <Icon size={20} aria-hidden="true" />
      </div>

      <span className={styles.workspaceEyebrow}>{eyebrow}</span>

      <h2>{title}</h2>
      <p>{description}</p>

      <InlineNotice title="V2 safety boundary" tone="protocol">
        This integration build intentionally leaves the transaction controls unmounted until{" "}
        {nextGate}
        verifies their exact V2 contract bindings.
      </InlineNotice>
    </Surface>
  );
}

export function MeridianWorkspace({
  authenticatedAddress,
  view,
  privacyShield,
  onNavigate,
  onOpenWallet,
  onTogglePrivacy,
}: MeridianWorkspaceProps) {
  const navigation = meridianNavigationItem(view);

  return (
    <section
      id="meridian-workspace"
      className={styles.workspace}
      tabIndex={-1}
      aria-labelledby="meridian-workspace-title"
    >
      <header className={styles.workspaceHeader}>
        <div>
          <span className={styles.workspaceEyebrow}>YOUR VEILPOT</span>

          <h1 id="meridian-workspace-title">{navigation.label}</h1>

          <p>{navigation.description}</p>
        </div>

        <ProtocolBadge>V2 · Ethereum Sepolia</ProtocolBadge>
      </header>

      {view === "overview" ? (
        <>
          <div className={styles.overviewGrid}>
            <Surface className={styles.privatePositionCard} elevation="raised">
              <header>
                <div>
                  <span className={styles.workspaceEyebrow}>PRIVATE POSITION</span>
                  <h2>Confidential by default</h2>
                </div>

                <HumanActionBadge>Shielded</HumanActionBadge>
              </header>

              <MeridianPrivateValue
                label="Private principal"
                state="sealed"
                detail={
                  privacyShield ? "Privacy Shield is on" : "No value has been explicitly revealed"
                }
              />

              <dl className={styles.positionMetadata}>
                <div>
                  <dt>Session wallet</dt>
                  <dd>{compactAddress(authenticatedAddress)}</dd>
                </div>

                <div>
                  <dt>Network</dt>
                  <dd>Ethereum Sepolia</dd>
                </div>

                <div>
                  <dt>Automatic decryption</dt>
                  <dd>Never</dd>
                </div>
              </dl>
            </Surface>

            <Surface className={styles.nextActionsCard}>
              <span className={styles.workspaceEyebrow}>SAFE NEXT ACTIONS</span>

              <h2>Choose what you want to do.</h2>

              <div className={styles.actionList}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate("save");
                  }}
                >
                  <WalletCards size={17} aria-hidden="true" />
                  <span>
                    <strong>Save privately</strong>
                    <small>Registration, deposit and withdrawal</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onNavigate("autopilot");
                  }}
                >
                  <CalendarClock size={17} aria-hidden="true" />
                  <span>
                    <strong>Configure Autopilot</strong>
                    <small>Bounded private saving windows</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onNavigate("veildraw");
                  }}
                >
                  <Gift size={17} aria-hidden="true" />
                  <span>
                    <strong>Open VeilDraw</strong>
                    <small>Three private prize tracks</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </Surface>
          </div>

          <Surface className={styles.protocolIdentityStrip}>
            <div>
              <Network size={18} aria-hidden="true" />
              <span>
                <strong>Active integration profile</strong>
                <small>Pool V2 · explicit Sepolia deployment</small>
              </span>
            </div>

            <AddressText>{compactAddress(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool)}</AddressText>

            <ExplorerLink
              href={`https://sepolia.etherscan.io/address/${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool}`}
            >
              Inspect Pool V2
            </ExplorerLink>
          </Surface>
        </>
      ) : null}

      {view === "save" ? <MeridianSaveControl authenticatedAddress={authenticatedAddress} /> : null}

      {view === "autopilot" ? (
        <div className={styles.featureGrid}>
          <GuardedFeature
            icon={CalendarClock}
            eyebrow="AUTOPILOT · V2"
            title="Bounded automation"
            description="Plan creation, confidential funding, exact windows, pause, resume, revoke and recovery will use the V2-bound Vault."
            nextGate="Meridian M5"
          />

          <Surface className={styles.boundaryCard}>
            <KeyRound size={20} aria-hidden="true" />

            <span className={styles.workspaceEyebrow}>AUTHORITY BOUNDARY</span>

            <h2>Execution is not custody.</h2>

            <p>
              Permissionless keepers can execute a valid committed window. They do not receive
              withdrawal rights, prize claim rights or private decryption access.
            </p>
          </Surface>
        </div>
      ) : null}

      {view === "veildraw" ? (
        <>
          <GuardedFeature
            icon={Gift}
            eyebrow="VEILDRAW · V2"
            title="One round. Three private prize tracks."
            description="Snapshot import, child draws, shard selection, winner resolution and finalization will be rebuilt from the real V2 lifecycle."
            nextGate="Meridian M6"
          />

          <div className={styles.prizeTrackGrid}>
            {[1, 2, 3].map((prize) => (
              <Surface className={styles.prizeTrack} key={prize}>
                <span>PRIZE {prize.toString()}</span>
                <strong>Private child draw</strong>
                <small>No winner, shard or entitlement is inferred by the shell.</small>
              </Surface>
            ))}
          </div>
        </>
      ) : null}

      {view === "activity" ? (
        <Surface className={styles.emptyState} elevation="raised">
          <Activity size={22} aria-hidden="true" />

          <span className={styles.workspaceEyebrow}>V2 ACTIVITY</span>

          <h2>No historical V1 feed is mounted here.</h2>

          <p>
            Meridian will index the V2 Pool, Vault, VeilDraw Engine and Prize Reserve in the
            dedicated V2 activity gate. Confidential transferred values will remain absent from
            notification copy.
          </p>

          <InlineNotice title="Fail-closed migration" tone="protocol">
            Until that migration is complete, Activity deliberately shows no fabricated or
            historical V1 account feed.
          </InlineNotice>
        </Surface>
      ) : null}

      {view === "privacy" ? (
        <div className={styles.featureGrid}>
          <Surface className={styles.privacyCard} elevation="raised">
            <LockKeyhole size={21} aria-hidden="true" />

            <span className={styles.workspaceEyebrow}>PRIVACY SHIELD</span>

            <h2>
              {privacyShield
                ? "Private presentation is shielded."
                : "Shield presentation is currently off."}
            </h2>

            <p>
              Privacy Shield changes presentation only. It never performs blockchain decryption.
            </p>

            <MeridianButton variant="private" onClick={onTogglePrivacy}>
              <LockKeyhole size={15} aria-hidden="true" />
              {privacyShield ? "Turn presentation shield off" : "Turn Privacy Shield on"}
            </MeridianButton>
          </Surface>

          <Surface className={styles.privacyCard}>
            <ShieldCheck size={21} aria-hidden="true" />

            <span className={styles.workspaceEyebrow}>REVEAL POLICY</span>

            <h2>Reveal stays explicit.</h2>

            <p>
              A private value must never appear because a page mounted, refreshed or changed route.
              Authorized private decryption remains a separate user decision.
            </p>
          </Surface>
        </div>
      ) : null}

      {view === "security" ? (
        <div className={styles.securityLayout}>
          <Surface className={styles.securitySummary} elevation="raised">
            <ShieldCheck size={22} aria-hidden="true" />

            <span className={styles.workspaceEyebrow}>ACTIVE DEPLOYMENT</span>

            <h2>Veilpot V2 · Ethereum Sepolia</h2>

            <p>
              The authenticated Meridian shell is bound to the explicit V2 integration profile.
              Historical V1 application surfaces remain preserved but are not mounted here.
            </p>

            <ProtocolBadge>Chain {VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId}</ProtocolBadge>
          </Surface>

          <Surface className={styles.deploymentList}>
            {DEPLOYMENT_ROWS.map(([label, address]) => (
              <div key={label}>
                <span>{label}</span>

                <AddressText>{compactAddress(address)}</AddressText>

                <ExplorerLink href={`https://sepolia.etherscan.io/address/${address}`}>
                  Inspect
                </ExplorerLink>
              </div>
            ))}

            <footer>
              <span>Audited source checkpoint</span>
              <code>{VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.deploymentSourceCommit}</code>
            </footer>
          </Surface>
        </div>
      ) : null}

      {view === "settings" ? (
        <div className={styles.featureGrid}>
          <Surface className={styles.settingsCard} elevation="raised">
            <span className={styles.workspaceEyebrow}>APPEARANCE</span>

            <h2>Meridian theme</h2>

            <p>
              Midnight is the signature default. Porcelain remains a fully designed light theme.
            </p>

            <ThemeControl />
          </Surface>

          <Surface className={styles.settingsCard}>
            <WalletCards size={21} aria-hidden="true" />

            <span className={styles.workspaceEyebrow}>WALLET & ACCESS</span>

            <h2>Session controls</h2>

            <p>
              Inspect the connected wallet, SIWE session, required network and explorer identity.
            </p>

            <MeridianButton variant="secondary" onClick={onOpenWallet}>
              Open wallet controls
            </MeridianButton>
          </Surface>
        </div>
      ) : null}
    </section>
  );
}
