const { spawn, spawnSync } = require("child_process");
const path = require("path");

const MAX_OUTPUT_CHARS = 64 * 1024;
const DELETE_TIMEOUT_MS = 15_000;

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class EchoDraftHandleDelete {
  const uint DELETE = 0x00010000;
  const uint FILE_READ_ATTRIBUTES = 0x00000080;
  const uint FILE_SHARE_READ = 0x00000001;
  const uint FILE_SHARE_WRITE = 0x00000002;
  const uint FILE_SHARE_DELETE = 0x00000004;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
  const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
  const int FileDispositionInfo = 4;

  [StructLayout(LayoutKind.Sequential)]
  struct FILE_DISPOSITION_INFO {
    [MarshalAs(UnmanagedType.Bool)] public bool DeleteFile;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct BY_HANDLE_FILE_INFORMATION {
    public uint FileAttributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFile(
    string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(
    SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION information);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandle(
    SafeFileHandle handle, StringBuilder path, uint pathLength, uint flags);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetFileInformationByHandle(
    SafeFileHandle handle, int informationClass, ref FILE_DISPOSITION_INFO information, uint size);

  static string FinalPath(SafeFileHandle handle) {
    var buffer = new StringBuilder(32768);
    uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
    if (length == 0 || length >= buffer.Capacity) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    string value = buffer.ToString();
    if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) {
      value = @"\\" + value.Substring(8);
    } else if (value.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) {
      value = value.Substring(4);
    }
    return Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
  }

  static bool IsInside(string root, string candidate) {
    if (String.Equals(root, candidate, StringComparison.OrdinalIgnoreCase)) return false;
    string prefix = root.EndsWith(Path.DirectorySeparatorChar.ToString())
      ? root
      : root + Path.DirectorySeparatorChar;
    return candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
  }

  public sealed class Result {
    public bool success;
    public bool deleted;
    public long bytes;
    public string error;
    public string volumeSerialNumber;
    public string fileIndex;
    public string finalPath;
    public bool isDirectory;
  }

  static string Volume(BY_HANDLE_FILE_INFORMATION info) {
    return info.VolumeSerialNumber.ToString();
  }

  static string Index(BY_HANDLE_FILE_INFORMATION info) {
    ulong value = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;
    return value.ToString();
  }

  static void RequireIdentity(
    BY_HANDLE_FILE_INFORMATION info,
    string expectedVolume,
    string expectedIndex,
    string label
  ) {
    if (!String.IsNullOrEmpty(expectedVolume) && Volume(info) != expectedVolume) {
      throw new InvalidOperationException(label + " volume identity changed");
    }
    if (!String.IsNullOrEmpty(expectedIndex) && Index(info) != expectedIndex) {
      throw new InvalidOperationException(label + " file identity changed");
    }
  }

  public static Result Identity(string targetPath, bool expectDirectory) {
    try {
      uint share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
      uint flags = FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT;
      using (SafeFileHandle target = CreateFile(
        targetPath, FILE_READ_ATTRIBUTES, share, IntPtr.Zero, OPEN_EXISTING, flags, IntPtr.Zero)) {
        if (target.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(target, out info)) {
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        bool isDirectory = (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 || isDirectory != expectDirectory) {
          throw new InvalidOperationException("Path is linked or has the wrong type");
        }
        return new Result {
          success = true,
          deleted = false,
          bytes = isDirectory ? 0 : ((long)info.FileSizeHigh << 32) | info.FileSizeLow,
          volumeSerialNumber = Volume(info),
          fileIndex = Index(info),
          finalPath = FinalPath(target),
          isDirectory = isDirectory
        };
      }
    } catch (Exception error) {
      return new Result { success = false, deleted = false, bytes = 0, error = error.Message };
    }
  }

  public static Result Delete(
    string rootPath,
    string candidatePath,
    bool expectDirectory,
    string expectedRootVolume,
    string expectedRootIndex,
    string expectedCandidateVolume,
    string expectedCandidateIndex
  ) {
    try {
      uint share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
      uint inspectFlags = FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT;
      using (SafeFileHandle root = CreateFile(
        rootPath, FILE_READ_ATTRIBUTES, share, IntPtr.Zero, OPEN_EXISTING, inspectFlags, IntPtr.Zero)) {
        if (root.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        BY_HANDLE_FILE_INFORMATION rootInfo;
        if (!GetFileInformationByHandle(root, out rootInfo)) {
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        if ((rootInfo.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            (rootInfo.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
          throw new InvalidOperationException("Verified root is linked or is not a directory");
        }
        RequireIdentity(rootInfo, expectedRootVolume, expectedRootIndex, "Verified root");

        using (SafeFileHandle candidate = CreateFile(
          candidatePath,
          DELETE | FILE_READ_ATTRIBUTES,
          share,
          IntPtr.Zero,
          OPEN_EXISTING,
          inspectFlags,
          IntPtr.Zero)) {
          if (candidate.IsInvalid) {
            int error = Marshal.GetLastWin32Error();
            if (error == 2 || error == 3) return new Result { success = true, deleted = false, bytes = 0 };
            throw new System.ComponentModel.Win32Exception(error);
          }
          BY_HANDLE_FILE_INFORMATION info;
          if (!GetFileInformationByHandle(candidate, out info)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
          }
          bool isDirectory = (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
          if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
              isDirectory != expectDirectory) {
            throw new InvalidOperationException("Candidate is linked or has the wrong type");
          }
          RequireIdentity(
            info,
            expectedCandidateVolume,
            expectedCandidateIndex,
            "Candidate"
          );
          string finalRoot = FinalPath(root);
          string finalCandidate = FinalPath(candidate);
          if (!IsInside(finalRoot, finalCandidate)) {
            throw new InvalidOperationException("Candidate resolved outside the verified root");
          }
          long bytes = isDirectory ? 0 : ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
          var disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
          if (!SetFileInformationByHandle(
            candidate,
            FileDispositionInfo,
            ref disposition,
            (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO)))) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
          }
          return new Result {
            success = true,
            deleted = true,
            bytes = bytes,
            volumeSerialNumber = Volume(info),
            fileIndex = Index(info),
            finalPath = finalCandidate,
            isDirectory = isDirectory
          };
        }
      }
    } catch (Exception error) {
      return new Result { success = false, deleted = false, bytes = 0, error = error.Message };
    }
  }
}
"@ | Out-Null

$payloadJson = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:ECHODRAFT_DELETE_PAYLOAD)
)
$payload = $payloadJson | ConvertFrom-Json
if ([string]$payload.operation -eq "identity") {
  [EchoDraftHandleDelete]::Identity(
    [string]$payload.target,
    [bool]$payload.expectDirectory
  ) | ConvertTo-Json -Compress
} else {
  [EchoDraftHandleDelete]::Delete(
    [string]$payload.root,
    [string]$payload.target,
    [bool]$payload.expectDirectory,
    [string]$payload.expectedRootVolume,
    [string]$payload.expectedRootIndex,
    [string]$payload.expectedCandidateVolume,
    [string]$payload.expectedCandidateIndex
  ) | ConvertTo-Json -Compress
}
`;

const parseLastJsonLine = (output) => {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking for the final structured line.
    }
  }
  return null;
};

const getPowerShellExecutable = () => {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
};

const createCommand = (payload) => ({
  executable: getPowerShellExecutable(),
  args: [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    POWERSHELL_SCRIPT,
  ],
  env: {
    ...process.env,
    ECHODRAFT_DELETE_PAYLOAD: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  },
});

const runWindowsHandleCommandSync = (payload) => {
  if (process.platform !== "win32") {
    throw new Error("Windows handle deletion is unavailable on this platform");
  }
  const command = createCommand(payload);
  const completed = spawnSync(command.executable, command.args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: DELETE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_CHARS,
    env: command.env,
  });
  if (completed.error) throw completed.error;
  const result = parseLastJsonLine(completed.stdout);
  if (completed.status !== 0 || !result) {
    throw new Error(
      String(completed.stderr || "").trim() ||
        `Handle operation failed with exit code ${completed.status}`
    );
  }
  return result;
};

const runWindowsHandleCommand = async (payload) => {
  if (process.platform !== "win32") {
    throw new Error("Windows handle deletion is unavailable on this platform");
  }
  const command = createCommand(payload);

  return await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: command.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };
    const appendBounded = (current, chunk) =>
      `${current}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS);
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() => {
        const result = parseLastJsonLine(stdout);
        if (code !== 0 || !result) {
          reject(new Error(stderr.trim() || `Handle operation failed with exit code ${code}`));
          return;
        }
        resolve(result);
      })
    );
    const timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(() => reject(new Error("Handle operation timed out")));
    }, DELETE_TIMEOUT_MS);
  });
};

const normalizeIdentity = (identity) => ({
  volumeSerialNumber: String(identity?.volumeSerialNumber || ""),
  fileIndex: String(identity?.fileIndex || ""),
});

const buildDeletePayload = (
  root,
  target,
  { expectDirectory = false, expectedRootIdentity = null, expectedTargetIdentity = null } = {}
) => {
  const resolvedRoot = path.resolve(String(root || ""));
  const resolvedTarget = path.resolve(String(target || ""));
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refused to delete a path outside the verified root");
  }
  const rootIdentity = normalizeIdentity(expectedRootIdentity);
  const targetIdentity = normalizeIdentity(expectedTargetIdentity);
  return {
    operation: "delete",
    root: resolvedRoot,
    target: resolvedTarget,
    expectDirectory,
    expectedRootVolume: rootIdentity.volumeSerialNumber,
    expectedRootIndex: rootIdentity.fileIndex,
    expectedCandidateVolume: targetIdentity.volumeSerialNumber,
    expectedCandidateIndex: targetIdentity.fileIndex,
  };
};

const getWindowsPathIdentity = async (target, { expectDirectory = false } = {}) => {
  const result = await runWindowsHandleCommand({
    operation: "identity",
    target: path.resolve(String(target || "")),
    expectDirectory,
  });
  if (!result?.success) throw new Error(result?.error || "Could not verify Windows path identity");
  return result;
};

const getWindowsPathIdentitySync = (target, { expectDirectory = false } = {}) => {
  const result = runWindowsHandleCommandSync({
    operation: "identity",
    target: path.resolve(String(target || "")),
    expectDirectory,
  });
  if (!result?.success) throw new Error(result?.error || "Could not verify Windows path identity");
  return result;
};

const deleteWindowsPathByHandle = async (root, target, options = {}) => {
  const result = await runWindowsHandleCommand(buildDeletePayload(root, target, options));
  return result;
};

const deleteWindowsPathByHandleSync = (root, target, options = {}) => {
  return runWindowsHandleCommandSync(buildDeletePayload(root, target, options));
};

module.exports = {
  DELETE_TIMEOUT_MS,
  POWERSHELL_SCRIPT,
  deleteWindowsPathByHandle,
  deleteWindowsPathByHandleSync,
  getWindowsPathIdentity,
  getWindowsPathIdentitySync,
  parseLastJsonLine,
};
