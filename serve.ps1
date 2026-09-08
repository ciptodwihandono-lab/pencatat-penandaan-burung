param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot
)

$Root = [System.IO.Path]::GetFullPath($Root)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving '$Root' at http://localhost:$Port/"

$mimeMap = @{
  ".html"        = "text/html; charset=utf-8"
  ".htm"         = "text/html; charset=utf-8"
  ".js"          = "text/javascript; charset=utf-8"
  ".mjs"         = "text/javascript; charset=utf-8"
  ".css"         = "text/css; charset=utf-8"
  ".json"        = "application/json; charset=utf-8"
  ".svg"         = "image/svg+xml"
  ".png"         = "image/png"
  ".jpg"         = "image/jpeg"
  ".jpeg"        = "image/jpeg"
  ".ico"         = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}

function Handle-Request($context) {
  $request = $context.Request
  $response = $context.Response
  try {
    $path = $request.Url.AbsolutePath
    if ($path -eq "/") { $path = "/index.html" }
    $path = [Uri]::UnescapeDataString($path)
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart('/'))))

    if (-not $filePath.StartsWith($Root) -or -not (Test-Path $filePath -PathType Leaf)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $response.StatusCode = 404
      $response.ContentType = "text/plain; charset=utf-8"
      $response.ContentLength64 = $body.Length
      $response.OutputStream.Write($body, 0, $body.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $contentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $response.StatusCode = 200
      $response.ContentType = $contentType
      $response.Headers.Add("Cache-Control", "no-cache")
      $response.Headers.Add("Service-Worker-Allowed", "/")
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try {
      $response.StatusCode = 500
    } catch {}
  } finally {
    $response.OutputStream.Close()
  }
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  Handle-Request $context
}
