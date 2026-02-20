import { ProviderTabs } from "../../ui/ProviderTabs";
import { DownloadProgressBar } from "../../ui/DownloadProgressBar";
import type { ModelPickerStyles } from "../../../utils/modelPickerStyles";
import { LOCAL_PROVIDER_TABS } from "../constants";
import { LocalModelCard } from "../LocalModelCard";
import { PARAKEET_MODEL_INFO, WHISPER_MODEL_INFO } from "../../../models/ModelRegistry";
import type { DownloadProgress } from "../../../hooks/useModelDownload";

interface LocalModel {
  model: string;
  size_mb?: number;
  downloaded?: boolean;
}

type DownloadModelFn = (modelId: string, onSelectAfterDownload?: (id: string) => void) => Promise<void>;

type Props = {
  styles: ModelPickerStyles;
  tabColorScheme: "purple" | "indigo";
  internalLocalProvider: string;
  onLocalProviderChange: (providerId: string) => void;
  useLocalWhisper: boolean;
  selectedLocalModel: string;
  localModels: LocalModel[];
  parakeetModels: LocalModel[];
  downloadingModel: string | null;
  downloadProgress: DownloadProgress;
  isInstalling: boolean;
  downloadingParakeetModel: string | null;
  parakeetDownloadProgress: DownloadProgress;
  isInstallingParakeet: boolean;
  isDownloadingModel: (modelId: string) => boolean;
  isCancelling: boolean;
  downloadModel: DownloadModelFn;
  cancelDownload: () => void;
  isDownloadingParakeetModel: (modelId: string) => boolean;
  isCancellingParakeet: boolean;
  downloadParakeetModel: DownloadModelFn;
  cancelParakeetDownload: () => void;
  onWhisperModelSelect: (modelId: string) => void;
  onWhisperModelDelete: (modelId: string) => void;
  onParakeetModelSelect: (modelId: string) => void;
  onParakeetModelDelete: (modelId: string) => void;
};

const getParakeetLanguageLabel = (language: string) => {
  return language === "multilingual" ? "25 languages" : "English";
};

export default function LocalModePanel(props: Props) {
  const {
    styles,
    tabColorScheme,
    internalLocalProvider,
    onLocalProviderChange,
    useLocalWhisper,
    selectedLocalModel,
    localModels,
    parakeetModels,
    downloadingModel,
    downloadProgress,
    isInstalling,
    downloadingParakeetModel,
    parakeetDownloadProgress,
    isInstallingParakeet,
    isDownloadingModel,
    isCancelling,
    downloadModel,
    cancelDownload,
    isDownloadingParakeetModel,
    isCancellingParakeet,
    downloadParakeetModel,
    cancelParakeetDownload,
    onWhisperModelSelect,
    onWhisperModelDelete,
    onParakeetModelSelect,
    onParakeetModelDelete,
  } = props;

  const progressDisplay = (() => {
    if (!useLocalWhisper) return null;

    if (downloadingModel && internalLocalProvider === "whisper") {
      const modelInfo = WHISPER_MODEL_INFO[downloadingModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingModel}
          progress={downloadProgress}
          isInstalling={isInstalling}
        />
      );
    }

    if (downloadingParakeetModel && internalLocalProvider === "nvidia") {
      const modelInfo = PARAKEET_MODEL_INFO[downloadingParakeetModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingParakeetModel}
          progress={parakeetDownloadProgress}
          isInstalling={isInstallingParakeet}
        />
      );
    }

    return null;
  })();

  const renderWhisperModels = () => {
    const modelsToRender =
      localModels.length === 0
        ? Object.entries(WHISPER_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : localModels;

    return (
      <div className="space-y-0.5">
        {modelsToRender.map((model) => {
          const modelId = model.model;
          const info = WHISPER_MODEL_INFO[modelId] ?? {
            name: modelId,
            description: "Model",
            size: "Unknown",
            recommended: false,
          };

          return (
            <LocalModelCard
              key={modelId}
              modelId={modelId}
              name={info.name}
              description={info.description}
              size={info.size}
              actualSizeMb={model.size_mb}
              isSelected={modelId === selectedLocalModel}
              isDownloaded={model.downloaded ?? false}
              isDownloading={isDownloadingModel(modelId)}
              isCancelling={isCancelling}
              recommended={info.recommended}
              provider="whisper"
              onSelect={() => onWhisperModelSelect(modelId)}
              onDelete={() => onWhisperModelDelete(modelId)}
              onDownload={() => downloadModel(modelId, onWhisperModelSelect)}
              onCancel={cancelDownload}
              styles={styles}
            />
          );
        })}
      </div>
    );
  };

  const renderParakeetModels = () => {
    const modelsToRender =
      parakeetModels.length === 0
        ? Object.entries(PARAKEET_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : parakeetModels;

    return (
      <div className="space-y-0.5">
        {modelsToRender.map((model) => {
          const modelId = model.model;
          const info = PARAKEET_MODEL_INFO[modelId] ?? {
            name: modelId,
            description: "NVIDIA Parakeet Model",
            size: "Unknown",
            language: "en",
            recommended: false,
          };

          return (
            <LocalModelCard
              key={modelId}
              modelId={modelId}
              name={info.name}
              description={info.description}
              size={info.size}
              actualSizeMb={model.size_mb}
              isSelected={modelId === selectedLocalModel}
              isDownloaded={model.downloaded ?? false}
              isDownloading={isDownloadingParakeetModel(modelId)}
              isCancelling={isCancellingParakeet}
              recommended={info.recommended}
              provider="nvidia"
              languageLabel={getParakeetLanguageLabel(info.language)}
              onSelect={() => onParakeetModelSelect(modelId)}
              onDelete={() => onParakeetModelDelete(modelId)}
              onDownload={() => downloadParakeetModel(modelId, onParakeetModelSelect)}
              onCancel={cancelParakeetDownload}
              styles={styles}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className="p-2 pb-0">
        <ProviderTabs
          providers={LOCAL_PROVIDER_TABS as any}
          selectedId={internalLocalProvider}
          onSelect={onLocalProviderChange}
          colorScheme={tabColorScheme}
        />
      </div>

      {progressDisplay}

      <div className="p-2">
        {internalLocalProvider === "whisper" && renderWhisperModels()}
        {internalLocalProvider === "nvidia" && renderParakeetModels()}
      </div>
    </div>
  );
}
