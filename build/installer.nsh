; Prefer the per-user Programs folder even when an older install was placed on
; the desktop. Leave the old registry entry intact so NSIS can uninstall the
; previous copy through its normal upgrade flow.
!macro pdDefaultInstallDirectory
  StrCpy $installMode "CurrentUser"
  SetShellVarContext current
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\PD Impression High Sierra"
  ; Preserve an explicitly supplied /D= destination for managed installations.
  !insertmacro GetDParameter $R0
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${EndIf}
!macroend

!macro customInit
  !insertmacro pdDefaultInstallDirectory
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ; The stock install-mode page would otherwise reload the old desktop path.
    !insertmacro pdDefaultInstallDirectory
    Abort
  !endif
!macroend
