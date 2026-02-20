const { assert, safeString } = require("./utils");
const { psJson } = require("./powershell");

async function setClipboardTestImage() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 24, 24
for ($x = 0; $x -lt 24; $x++) {
  for ($y = 0; $y -lt 24; $y++) {
    $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, ($x * 10) % 255, ($y * 10) % 255, 80))
  }
}
[System.Windows.Forms.Clipboard]::SetImage($bmp)
$img = [System.Windows.Forms.Clipboard]::GetImage()
$bmp2 = New-Object System.Drawing.Bitmap $img
$ms = New-Object System.IO.MemoryStream
for ($y = 0; $y -lt $bmp2.Height; $y++) {
  for ($x = 0; $x -lt $bmp2.Width; $x++) {
    $argb = [Int32]$bmp2.GetPixel($x, $y).ToArgb()
    $b = [System.BitConverter]::GetBytes($argb)
    $ms.Write($b, 0, $b.Length) | Out-Null
  }
}
$pixelBytes = $ms.ToArray()
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash($pixelBytes)
$hash = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
[pscustomobject]@{ success = $true; hasImage = $true; width = $bmp2.Width; height = $bmp2.Height; len = [Int32]$pixelBytes.Length; hash = $hash } | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [], { sta: true, timeoutMs: 20000 });
  assert(result.code === 0, `setClipboardTestImage failed: ${result.stderr}`);
  assert(result.parsed?.success, `setClipboardTestImage returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function getClipboardImageHash() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  [pscustomobject]@{ success = $true; hasImage = $false } | ConvertTo-Json -Compress
  exit 0
}
$img = [System.Windows.Forms.Clipboard]::GetImage()
$bmp2 = New-Object System.Drawing.Bitmap $img
$ms = New-Object System.IO.MemoryStream
for ($y = 0; $y -lt $bmp2.Height; $y++) {
  for ($x = 0; $x -lt $bmp2.Width; $x++) {
    $argb = [Int32]$bmp2.GetPixel($x, $y).ToArgb()
    $b = [System.BitConverter]::GetBytes($argb)
    $ms.Write($b, 0, $b.Length) | Out-Null
  }
}
$pixelBytes = $ms.ToArray()
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash($pixelBytes)
$hash = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
[pscustomobject]@{ success = $true; hasImage = $true; width = $bmp2.Width; height = $bmp2.Height; len = [Int32]$pixelBytes.Length; hash = $hash } | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [], { sta: true, timeoutMs: 20000 });
  assert(result.code === 0, `getClipboardImageHash failed: ${result.stderr}`);
  assert(result.parsed?.success, `getClipboardImageHash returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function getClipboardText() {
  const script = `Get-Clipboard -Raw | ConvertTo-Json -Compress`.trim();
  const result = await psJson(script, [], { sta: true, timeoutMs: 10000 });
  if (result.code !== 0) {
    return "";
  }
  if (typeof result.parsed === "string") {
    return result.parsed;
  }
  return safeString(result.stdout).trim();
}

async function snapshotClipboardForRestore() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$text = $null
$rtf = $null
$html = $null
$imagePngB64 = $null
$imageWidth = $null
$imageHeight = $null
$imageSkipped = $false

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::UnicodeText)) {
    $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::Rtf)) {
    $rtf = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Rtf)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::Html)) {
    $html = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if ($img -ne $null) {
      $imageWidth = [Int32]$img.Width
      $imageHeight = [Int32]$img.Height
      $pixels = [Int64]$imageWidth * [Int64]$imageHeight
      if ($pixels -le 6000000) {
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        if ($bytes -ne $null -and $bytes.Length -gt 0) {
          $imagePngB64 = [System.Convert]::ToBase64String($bytes)
        }
      } else {
        $imageSkipped = $true
      }
    }
  }
} catch {}

[pscustomobject]@{
  success = $true
  text = $text
  rtf = $rtf
  html = $html
  imagePngB64 = $imagePngB64
  imageWidth = $imageWidth
  imageHeight = $imageHeight
  imageSkipped = [bool]$imageSkipped
} | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [], { sta: true, timeoutMs: 20000 });
  if (result.code !== 0) {
    return null;
  }
  return result.parsed?.success ? result.parsed : null;
}

async function restoreClipboardSnapshot(snapshot) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$raw = ""
try {
  while (-not [Console]::In.EndOfStream) {
    $line = [Console]::In.ReadLine()
    if ($line -ne $null) { $raw += $line }
  }
} catch {}

if (-not $raw -or $raw.Length -lt 2) {
  [pscustomobject]@{ success = $false; reason = "no_input" } | ConvertTo-Json -Compress
  exit 0
}

$snap = $null
try { $snap = $raw | ConvertFrom-Json } catch {
  [pscustomobject]@{ success = $false; reason = "invalid_json"; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 0
}

$dataObj = New-Object System.Windows.Forms.DataObject

try {
  if ($snap.text -ne $null -and ($snap.text.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.text.ToString(), [System.Windows.Forms.TextDataFormat]::UnicodeText)
  }
} catch {}

try {
  if ($snap.rtf -ne $null -and ($snap.rtf.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.rtf.ToString(), [System.Windows.Forms.TextDataFormat]::Rtf)
  }
} catch {}

try {
  if ($snap.html -ne $null -and ($snap.html.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.html.ToString(), [System.Windows.Forms.TextDataFormat]::Html)
  }
} catch {}

try {
  if ($snap.imagePngB64 -ne $null -and ($snap.imagePngB64.ToString()).Length -gt 0) {
    $bytes = [System.Convert]::FromBase64String($snap.imagePngB64.ToString())
    if ($bytes -ne $null -and $bytes.Length -gt 0) {
      $ms = New-Object System.IO.MemoryStream(, $bytes)
      $img = [System.Drawing.Image]::FromStream($ms)
      if ($img -ne $null) {
        $dataObj.SetImage($img)
      }
    }
  }
} catch {}

try {
  [System.Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)
  [pscustomobject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ success = $false; reason = "restore_failed"; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`.trim();

  try {
    const result = await psJson(script, [], {
      sta: true,
      timeoutMs: 20000,
      stdin: JSON.stringify(snapshot),
    });
    return Boolean(result.parsed?.success);
  } catch {
    return false;
  }
}

module.exports = {
  getClipboardImageHash,
  getClipboardText,
  restoreClipboardSnapshot,
  setClipboardTestImage,
  snapshotClipboardForRestore,
};

