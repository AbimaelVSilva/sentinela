import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  ClipboardPasteIcon,
  KeyboardIcon,
  LoaderCircleIcon,
  QrCodeIcon,
  SmartphoneIcon,
  WifiOffIcon,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CopyField } from '@/components/CopyField';
import { QrScanner } from '@/components/QrScanner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, type Camera, queryKeys, type RtmpInfo } from '@/lib/api';
import { MIBO_MODELS, parseMiboQr } from '@/lib/mibo-qr';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3;
const STEPS = ['Identificação', 'Destino RTMP', 'Aguardando sinal'] as const;
const WAIT_HINT_MS = 60_000;

export function AddCameraWizard({
  storeId,
  defaultName = 'Câmera da prateleira',
  open,
  onOpenChange,
}: {
  storeId: string;
  /** Nome sugerido (ex.: "Câmera 2" quando a loja já tem câmeras). */
  defaultName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <WizardBody
          storeId={storeId}
          defaultName={defaultName}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Monta a cada abertura do Dialog: o wizard sempre recomeça do passo 1. */
function WizardBody({
  storeId,
  defaultName,
  onClose,
}: {
  storeId: string;
  defaultName: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [created, setCreated] = useState<{ camera: Camera; rtmp: RtmpInfo } | null>(null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adicionar câmera</DialogTitle>
        <DialogDescription>Conecte uma câmera Intelbras Mibo via RTMP.</DialogDescription>
      </DialogHeader>

      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border font-medium',
                  n < step && 'border-success bg-success text-white',
                  n === step && 'border-foreground bg-foreground text-background',
                  n > step && 'text-muted-foreground',
                )}
              >
                {n < step ? '✓' : n}
              </span>
              <span className={cn('truncate', n !== step && 'text-muted-foreground')}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <IdentifyStep
          storeId={storeId}
          defaultName={defaultName}
          onCreated={(res) => {
            setCreated(res);
            setStep(2);
          }}
        />
      )}
      {step === 2 && created && <RtmpStep rtmp={created.rtmp} onNext={() => setStep(3)} />}
      {step === 3 && created && (
        <WaitStep camera={created.camera} onBack={() => setStep(2)} onClose={onClose} />
      )}
    </>
  );
}

function IdentifyStep({
  storeId,
  defaultName,
  onCreated,
}: {
  storeId: string;
  defaultName: string;
  onCreated: (res: { camera: Camera; rtmp: RtmpInfo }) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'qr' | 'manual'>('qr');
  const [name, setName] = useState(defaultName);
  const [model, setModel] = useState<string>('');
  const [customModel, setCustomModel] = useState('');
  const [serial, setSerial] = useState('');
  const [qrRaw, setQrRaw] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [parseInfo, setParseInfo] = useState<'ok' | 'partial' | 'none' | null>(null);

  const applyQr = (raw: string) => {
    const parsed = parseMiboQr(raw);
    setQrRaw(raw);
    if (parsed.serial) setSerial(parsed.serial);
    if (parsed.model) {
      if ((MIBO_MODELS as readonly string[]).includes(parsed.model)) setModel(parsed.model);
      else {
        setModel('Outro');
        setCustomModel(parsed.model);
      }
    }
    setParseInfo(
      parsed.serial && parsed.model ? 'ok' : parsed.serial || parsed.model ? 'partial' : 'none',
    );
    setTab('manual');
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.createCamera(storeId, {
        name: name.trim(),
        model: model === 'Outro' ? customModel.trim() || 'Outro' : model || null,
        serial: serial.trim() || null,
        qrRaw,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.stores });
      qc.setQueryData(queryKeys.camera(res.camera.id), res.camera);
      onCreated(res);
    },
    onError: (err) =>
      toast.error('Não foi possível cadastrar a câmera', { description: err.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'qr' | 'manual')}>
        <TabsList className="w-full">
          <TabsTrigger value="qr">
            <QrCodeIcon /> Escanear QR
          </TabsTrigger>
          <TabsTrigger value="manual">
            <KeyboardIcon /> Manual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qr" className="grid gap-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Aponte para o QR da etiqueta da câmera Mibo (ou o exibido no app Mibo Smart).
          </p>
          {tab === 'qr' && <QrScanner onResult={applyQr} />}
          <div className="grid gap-1.5">
            <Label htmlFor="qr-paste" className="text-xs text-muted-foreground">
              Ou cole o conteúdo do QR
            </Label>
            <div className="flex gap-2">
              <Input
                id="qr-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Conteúdo lido por outro app"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!pasted.trim()}
                onClick={() => applyQr(pasted.trim())}
              >
                <ClipboardPasteIcon /> Usar
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="grid gap-4 pt-2">
          {qrRaw && (
            <Alert className={cn(parseInfo === 'none' && 'border-severity-attention/50')}>
              <QrCodeIcon />
              <AlertTitle>
                {parseInfo === 'ok'
                  ? 'QR lido: modelo e série preenchidos'
                  : parseInfo === 'partial'
                    ? 'QR lido: alguns dados preenchidos'
                    : 'QR lido, mas sem dados reconhecidos'}
              </AlertTitle>
              <AlertDescription>
                {parseInfo !== 'ok' && <p>Complete os campos manualmente. Conteúdo bruto:</p>}
                <Textarea readOnly value={qrRaw} className="mt-1 font-mono text-xs" rows={2} />
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="cam-name">Nome</Label>
            <Input
              id="cam-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Modelo</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {MIBO_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {model === 'Outro' && (
                <Input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="Qual modelo?"
                  maxLength={60}
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cam-serial">Número de série (opcional)</Label>
              <Input
                id="cam-serial"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                maxLength={120}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        {tab === 'qr' && (
          <Button type="button" variant="ghost" onClick={() => setTab('manual')}>
            Pular QR
          </Button>
        )}
        <Button type="submit" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending && <LoaderCircleIcon className="animate-spin" />}
          Gerar destino RTMP
        </Button>
      </DialogFooter>
    </form>
  );
}

function RtmpStep({ rtmp, onNext }: { rtmp: RtmpInfo; onNext: () => void }) {
  const isLocal = /\/\/(localhost|127\.|0\.0\.0\.0|SEU_HOST)/i.test(rtmp.fullUrl);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          <CopyField label="URL completa" value={rtmp.fullUrl} />
          <CopyField label="Servidor" value={rtmp.serverUrl} />
          <CopyField label="Chave de transmissão" value={rtmp.streamKey} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={rtmp.fullUrl} size={148} />
          </div>
          <span className="text-center text-xs text-muted-foreground">
            Escaneie no celular
            <br />
            para levar a URL
          </span>
        </div>
      </div>

      {isLocal && (
        <Alert className="border-severity-attention/50">
          <WifiOffIcon />
          <AlertTitle>URL não acessível pela internet</AlertTitle>
          <AlertDescription>
            Configure <code>PUBLIC_RTMP_URL</code> no <code>.env</code> com um túnel TCP (ex.:
            ngrok) ou VPS. Para testes locais use <code>api/scripts/simulate-camera.sh</code>.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <SmartphoneIcon />
        <AlertTitle>Configurar no app Mibo Smart</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Abra o Mibo Smart e selecione a câmera.</li>
            <li>Entre em Configurações → Transmissão RTMP.</li>
            <li>Cole a URL completa (ou servidor + chave, se o app pedir separado).</li>
            <li>Prefira codificação H.264 e salve.</li>
          </ol>
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button onClick={onNext}>Já configurei, aguardar sinal</Button>
      </DialogFooter>
    </div>
  );
}

function WaitStep({
  camera,
  onBack,
  onClose,
}: {
  camera: Camera;
  onBack: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [slow, setSlow] = useState(false);
  const { data } = useQuery({
    queryKey: queryKeys.camera(camera.id),
    queryFn: () => api.getCamera(camera.id),
    initialData: camera,
    refetchInterval: (q) => (q.state.data?.status === 'online' ? false : 2_000),
  });
  const online = data.status === 'online';

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), WAIT_HINT_MS);
    return () => clearTimeout(t);
  }, []);

  const finish = () => {
    onClose();
    void navigate(`/lojas/${camera.storeId}/cameras/${camera.id}`);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        {online ? (
          <>
            <CheckCircle2Icon className="size-12 text-success" />
            <div>
              <p className="font-medium">Sinal recebido!</p>
              <p className="text-sm text-muted-foreground">
                Codec: {data.stream?.videoCodec ?? 'desconhecido'}
              </p>
            </div>
            {data.stream?.isH265 && (
              <Alert className="border-severity-attention/50 text-left">
                <AlertTitle>Vídeo em H.265</AlertTitle>
                <AlertDescription>
                  O player usará HLS (latência maior). Configure H.264 na câmera para WebRTC.
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            <LoaderCircleIcon className="size-12 animate-spin text-muted-foreground" />
            <div>
              <p className="font-medium">Aguardando a câmera conectar…</p>
              <p className="text-sm text-muted-foreground">
                Isso acontece assim que a Mibo começar a transmitir.
              </p>
            </div>
            {slow && (
              <Alert className="text-left">
                <AlertTitle>Ainda sem sinal</AlertTitle>
                <AlertDescription>
                  Confira se a URL foi colada corretamente, se a câmera está online no app e se a
                  porta RTMP está acessível pela internet. Você pode concluir agora — o status
                  atualiza sozinho quando o sinal chegar.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        {!online && (
          <Button variant="outline" onClick={onBack}>
            Ver URL de novo
          </Button>
        )}
        <Button onClick={finish}>Concluir</Button>
      </DialogFooter>
    </div>
  );
}
